/**
 * Entidad de dominio: Wallet.
 * Representa una cuenta Stellar. El secreto se mantiene solo en memoria.
 */
export class Wallet {
  constructor(public address: string, public secret?: string) {}
}
