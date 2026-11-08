/**
 * Puerto de salida: enviador de pagos con patrocinador de comisiones (fee-bump).
 * Recibe un XDR de transacción de pago ya firmado por el usuario y lo envía
 * envolviéndolo en una fee-bump transacción pagada por el sponsor.
 */
export interface PaymentSubmitter {
  submitWithSponsor(txXdr: string): Promise<string>;
}
