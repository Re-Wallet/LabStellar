import { describe, it, expect, vi } from 'vitest';
import { CreateFundedWallet } from '../../application/use-cases/CreateFundedWallet';
import { Wallet } from '../../domain/Wallet';
import { WalletProvider } from '../../application/ports/WalletProvider';

describe('CreateFundedWallet (caso de uso)', () => {
  it('delegar al proveedor de wallets y devolver la wallet', async () => {
    const expected = new Wallet('GABC...', 'SABC...');
    const provider: WalletProvider = { createWallet: vi.fn().mockResolvedValue(expected) };

    const useCase = new CreateFundedWallet(provider);
    const result = await useCase.execute();

    expect(result).toBe(expected);
    expect(result.address).toBe('GABC...');
    expect(result.secret).toBe('SABC...');
  });
});
