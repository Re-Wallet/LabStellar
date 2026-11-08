import {
  Keypair,
  Networks,
  TransactionBuilder,
  Horizon,
} from '@stellar/stellar-sdk';
import { PaymentSubmitter } from '../../application/ports/PaymentSubmitter';

export class StellarPaymentSubmitter implements PaymentSubmitter {
  constructor(
    private readonly sponsorSecret: string,
    private readonly horizonUrl: string = 'https://horizon-testnet.stellar.org',
    private readonly networkPassphrase: string = Networks.TESTNET,
    private readonly horizon?: Horizon.Server,
  ) {}

  async submitWithSponsor(txXdr: string): Promise<string> {
    const innerTransaction = TransactionBuilder.fromXDR(
      txXdr,
      this.networkPassphrase,
    ) as any;

    const sponsor = Keypair.fromSecret(this.sponsorSecret);

    const feeBumpTransaction = TransactionBuilder.buildFeeBumpTransaction(
      sponsor,
      '100',
      innerTransaction,
      this.networkPassphrase,
    );

    feeBumpTransaction.sign(sponsor);

    const server = this.horizon ?? new Horizon.Server(this.horizonUrl);
    const result = await server.submitTransaction(feeBumpTransaction as any);

    return result.hash;
  }
}
