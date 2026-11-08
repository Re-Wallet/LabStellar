/**
 * Caso de uso: enviar un pago patrocinado (fee-bump).
 *
 * Recibe el XDR de una transacción de pago YA firmada por el remitente y lo
 * envía a través del `PaymentSubmitter` para que el sponsor pague la comisión
 * de red. No depende de Stellar SDK ni de child_process.
 */
export class SendSponsoredPayment {
  constructor(private readonly paymentSubmitter: any /* PaymentSubmitter */) {}

  async execute(txXdr: string): Promise<string> {
    if (!txXdr || typeof txXdr !== 'string') {
      throw new Error('txXdr es requerido para enviar el pago patrocinado');
    }
    return this.paymentSubmitter.submitWithSponsor(txXdr);
  }
}
