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
import { WalletProvider as WalletProviderPort } from '../../application/ports/WalletProvider';
import { SecretProvider } from '../../application/ports/SecretProvider';

const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const USDC = new Asset('USDC', USDC_ISSUER);

export class StellarSponsoredWalletProvider implements WalletProvider {
  constructor(
    private readonly sponsorSecretProvider: SecretProvider,
    private readonly horizonUrl: string = 'https://horizon-testnet.stellar.org',
    private readonly networkPassphrase: string = Networks.TESTNET,
    private readonly horizon?: Horizon.Server,
  ) {}

  async createWallet(): Promise<Wallet> {
    const server = this.horizon ?? new Horizon.Server(this.horizonUrl);
    const sponsorSecret = await this.sponsorSecretProvider.getSponsorSecret();
    const sponsor = Keypair.fromSecret(sponsorSecret);
    const sponsorAccount = await server.loadAccount(sponsor.publicKey());
    const user = Keypair.random();

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
    innerTrustlineTx.sign(user);

    const feeBumpTrustline = TransactionBuilder.buildFeeBumpTransaction(
      sponsor,
      '100',
      innerTrustlineTx as any,
      this.networkPassphrase,
    );
    feeBumpTrustline.sign(sponsor);
    await server.submitTransaction(feeBumpTrustline as any);

    return new Wallet(user.publicKey(), user.secret());
  }
}
