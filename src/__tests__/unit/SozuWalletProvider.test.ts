import { describe, it, expect, vi } from 'vitest';
import { SozuWalletProvider } from '../../infrastructure/sozu/SozuWalletProvider';

describe('SozuWalletProvider (adaptador)', () => {
  const successJson = JSON.stringify({
    success: true,
    wallet: { address: 'GABC...', secret: 'SABC...', generated: true },
  });

  it('parsea el JSON de sozu-faucet y devuelve Wallet', async () => {
    const run = vi.fn().mockResolvedValue(successJson);
    const provider = new SozuWalletProvider(run);

    const wallet = await provider.createWallet();

    expect(run).toHaveBeenCalledWith('npx @sozu/faucet claim');
    expect(wallet.address).toBe('GABC...');
    expect(wallet.secret).toBe('SABC...');
  });

  it('lanza error si no hay wallet en la respuesta', async () => {
    const run = vi.fn().mockResolvedValue(JSON.stringify({ success: false }));
    const provider = new SozuWalletProvider(run);

    await expect(provider.createWallet()).rejects.toThrow('no devolvió una wallet');
  });
});
