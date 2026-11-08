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
import { SecretProvider } from '../../application/ports/SecretProvider';

const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const USDC = new Asset('USDC', USDC_ISSUER);

/**
 * Adaptador de infraestructura: proveedor de wallets mediante Sponsored Reserves.
 *
 * Crea una cuenta Stellar sin que el usuario final necesite XLM:
 * 1. El sponsor crea la cuenta con startingBalance: '1' (minimum balance de 1 XLM bloqueado).
 * 2. El sponsor añade la trustline de USDC (paga el reserve de 0.5 XLM y la comisión de red vía fee-bump).
 *
 * La wallet nace con 0 XLM disponibles para gastar, pero con su minimum balance
 * de 1 XLM bloqueado (necesario para existir en la red). Ideal para Mainnet
 * donde no existe Friendbot.
 *
 * El secreto del sponsor se obtiene vía el puerto SecretProvider.
 *
 * `horizon` es inyectable para pruebas sin red.
 */
export class StellarSponsoredWalletProvider implements WalletProvider {
  constructor(
    private readonly sponsorSecretProvider: SecretProvider,
    private readonly horizonUrl: string = 'https://horizon-testnet.stellar.org',
    private readonly networkPassphrase: string = Networks.TESTNET,
    private readonly horizon?: Horizon.Server,
  ) {}

  private validateSecret(secret: string): void {
    if (!secret || typeof secret !== 'string') {
      throw new Error(
        'Clave secreta Stellar inválida: no se proporcionó una clave secreta.',
      );
    }

    if (!secret.startsWith('S') || secret.length !== 56) {
      throw new Error(
        `Clave secreta Stellar inválida: debe empezar con 'S' y tener exactamente 56 caracteres. Recibido "${secret.slice(0, 6)}..." (${secret.length} caracteres).`,
      );
    }

    try {
      Keypair.fromSecret(secret);
    } catch {
      throw new Error(
        'Clave secreta Stellar inválida: la clave no pudo ser decodificada por el SDK Stellar. Verifica que no tenga espacios ni caracteres extra.',
      );
    }
  }

  async createWallet(): Promise<Wallet> {
    const server = this.horizon ?? new Horizon.Server(this.horizonUrl);

    // 1. Obtener el secreto del sponsor vía el puerto (inyección de dependencia)
    const sponsorSecret = await this.sponsorSecretProvider.getSponsorSecret();

    // Validar el formato antes de usarlo
    this.validateSecret(sponsorSecret);

    const sponsor = Keypair.fromSecret(sponsorSecret);
    const sponsorAccount = await server.loadAccount(sponsor.publicKey());
    const user = Keypair.random();

    // 2. Sponsor crea la cuenta del usuario (reserve base 1 XLM pagado por el sponsor).
    // startingBalance: '1' le da a la cuenta su minimum balance de 1 XLM bloqueado.
    // Sin esto, una cuenta con 0 XLM no puede agregar trustlines ni operar.
    const createAccountTx = new TransactionBuilder(sponsorAccount, {
      fee: '100',
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        Operation.createAccount({
          destination: user.publicKey(),
          startingBalance: '1',
          sponsor: sponsor.publicKey(),
        } as any),
      )
      .setTimeout(60)
      .build();
    createAccountTx.sign(sponsor);
    await server.submitTransaction(createAccountTx);

    // 3. Sponsor añade la trustline USDC a la cuenta del usuario (reserve 0.5 XLM pagado por el sponsor vía fee-bump).
    const userAccount = await server.loadAccount(user.publicKey());
    const innerTrustlineTx = new TransactionBuilder(userAccount, {
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
    innerTrustlineTx.sign(user); // dueño de la cuenta autoriza la trustline

    const feeBumpTrustline = TransactionBuilder.buildFeeBumpTransaction(
      sponsor,
      '100', // baseFee (stroops) — el sponsor paga
      innerTrustlineTx as any,
      this.networkPassphrase,
    );
    feeBumpTrustline.sign(sponsor);
    await server.submitTransaction(feeBumpTrustline as any);

    return new Wallet(user.publicKey(), user.secret());
  }
}
