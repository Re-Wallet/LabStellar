import {
  Keypair,
  Networks,
  TransactionBuilder,
  Horizon,
} from '@stellar/stellar-sdk';
import { PaymentSubmitter } from '../../application/ports/PaymentSubmitter';
import { SecretProvider } from '../../application/ports/SecretProvider';

/**
 * Adaptador de infraestructura: enviador de pagos patrocinados (fee-bump).
 *
 * Recibe el XDR de una transacción de pago YA firmada por el usuario (wallet A),
 * la envuelve en una fee-bump transaction pagada por el sponsor y la envía a
 * Horizon (Stellar Testnet). La comisión de red es pagada por la cuenta del
 * sponsor, no por la wallet del usuario.
 *
 * El secreto del sponsor se obtiene vía el puerto SecretProvider (inyección de
 * dependencia), lo que permite usar diferentes proveedores (variable de entorno,
 * archivo cifrado, AWS Secrets Manager, etc.) sin modificar este adaptador.
 *
 * `horizon` es inyectable para pruebas sin red.
 */
export class StellarPaymentSubmitter implements PaymentSubmitter {
  constructor(
    private readonly sponsorSecretProvider: SecretProvider,
    private readonly horizonUrl: string = 'https://horizon-testnet.stellar.org',
    private readonly networkPassphrase: string = Networks.TESTNET,
    private readonly horizon?: Horizon.Server,
  ) {}

  async submitWithSponsor(txXdr: string): Promise<string> {
    // 1. Obtener el secreto del sponsor vía el puerto (inyección de dependencia)
    const sponsorSecret = await this.sponsorSecretProvider.getSponsorSecret();

    // 2. Reconstruir la transacción de pago interna ya firmada por el usuario.
    const innerTransaction = TransactionBuilder.fromXDR(
      txXdr,
      this.networkPassphrase,
    ) as any;

    // 3. Keypair del sponsor (quien paga la comisión).
    const sponsor = Keypair.fromSecret(sponsorSecret);

    // 4. Construir la fee-bump transaction.
    const feeBumpTransaction = TransactionBuilder.buildFeeBumpTransaction(
      sponsor,
      '100', // baseFee (stroops) — el sponsor paga
      innerTransaction,
      this.networkPassphrase,
    );

    // 5. Firmar la fee-bump con el sponsor.
    feeBumpTransaction.sign(sponsor);

    // 6. Enviar a Horizon.
    const server = this.horizon ?? new Horizon.Server(this.horizonUrl);
    const result = await server.submitTransaction(feeBumpTransaction as any);

    return result.hash;
  }
}
