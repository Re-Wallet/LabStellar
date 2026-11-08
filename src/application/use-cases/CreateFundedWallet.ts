import { Wallet } from '../../domain/Wallet';
import { WalletProvider } from '../ports/WalletProvider';

/**
 * Caso de uso: crear una wallet financiada.
 *
 * Orquesta la creación de una wallet Stellar Testnet con 0 XLM para el
 * usuario final, fondeada con USDC vía Sozu Faucet (Friendbot + trustline +
 * claim). No depende de Stellar SDK ni de child_process.
 */
export class CreateFundedWallet {
  constructor(private readonly walletProvider: WalletProvider) {}

  async execute(): Promise<Wallet> {
    return this.walletProvider.createWallet();
  }
}
