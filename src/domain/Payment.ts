/**
 * Entidad de dominio: Payment.
 * Representa una transferencia de un activo entre dos cuentas Stellar.
 * `amount` se modela como string para evitar problemas de precisión con decimales.
 */
export class Payment {
  constructor(
    public from: string,
    public to: string,
    public amount: string,
    public asset: string, // ej. "USDC" o "USDC:GBBD..."
  ) {}
}
