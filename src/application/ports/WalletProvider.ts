/**
 * Puerto de salida: proveedor de wallets.
 * El dominio no conoce Stellar SDK ni child_process; solo depende de esta interfaz.
 */
import { Wallet } from '../../domain/Wallet';

export interface WalletProvider {
  createWallet(): Promise<Wallet>;
}
