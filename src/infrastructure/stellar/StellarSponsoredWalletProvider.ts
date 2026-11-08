import {
  Keypair,
  Networks,
  TransactionBuilder,
  Horizon,
  Operation,
  Asset,
} from '@stellar/stellar-sdk';
import { Wallet } from '../../domain/Wallet';
import { WalletProvider } from '../../application/ports/WalletProvider';

const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const USDC = new Asset('USDC', USDC_ISSUER);

/**
 * Adaptador de infraestructura: proveedor de wallets mediante Sponsored Reserves.
 *
 * Crea una cuenta Stellar sin que el usuario final necesite XLM:
 * 1. El sponsor crea la cuenta (paga el reserve de 1 XLM).
 * 2. El sponsor añade la trustline de USDC (paga el reserve de 0.5 XLM).
 *
 * La wallet nace con 0 XLM disponibles, ya existe en la red y tiene la
 * trustline USDC activa. Ideal para Mainnet donde no existe Friendbot.
 *
 * `horizon` es inyectable para pruebas sin red.
 */
export class StellarSponsoredWalletProvider implements WalletProvider {
  constructor(
    private readonly sponsorSecret: string,
    private readonly horizonUrl: string = 'https://horizon-testnet.stellar.org',
    private readonly networkPassphrase: string = Networks.TESTNET,
    private readonly horizon?: Horizon.Server,
  ) {}

  async createWallet(): Promise<Wallet> {
    const server = this.horizon ?? new Horizon.Server(this.horizonUrl);
    const sponsor = Keypair.fromSecret(this.sponsorSecret);
    const sponsorAccount = await server.loadAccount(sponsor.publicKey());
    const user = Keypair.random();

    // 1. Sponsor crea la cuenta del usuario (reserve base 1 XLM pagado por el sponsor).
    const createAccountTx = new TransactionBuilder(sponsorAccount, {
      fee: '100',
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        Operation.createAccount({
          destination: user.publicKey(),
          startingBalance: '0',
          sponsor: sponsor.publicKey(),
        } as any),
      )
      .setTimeout(60)
      .build();
    createAccountTx.sign(sponsor);
    await server.submitTransaction(createAccountTx);

    // 2. Sponsor añade la trustline USDC a la cuenta del usuario (reserve 0.5 XLM pagado por el sponsor).
    const userAccount = await server.loadAccount(user.publicKey());
    const trustlineTx = new TransactionBuilder(userAccount, {
      fee: '100',
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        Operation.changeTrust({
          asset: USDC,
          sponsor: sponsor.publicKey(),
        } as any),
      )
      .setTimeout(60)
      .build();
    trustlineTx.sign(user); // dueño de la cuenta autoriza la trustline
    trustlineTx.sign(sponsor); // sponsor paga el reserve de la trustline
    await server.submitTransaction(trustlineTx);

    return new Wallet(user.publicKey(), user.secret());
  }
}
