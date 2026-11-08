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

  it('reintenta si el faucet devuelve error de cooldown en el JSON', async () => {
    const cooldownJson = JSON.stringify({
      success: false,
      reason: 'user_cooldown',
      nextAvailableAt: new Date(Date.now() + 100).toISOString(),
    });
    const run = vi.fn()
      .mockResolvedValueOnce(cooldownJson)
      .mockResolvedValueOnce(successJson);

    const provider = new SozuWalletProvider(run, { maxRetries: 3, baseDelayMs: 10 });

    const wallet = await provider.createWallet();

    expect(run).toHaveBeenCalledTimes(2);
    expect(wallet.address).toBe('GABC...');
  });

  it('reintenta si el error es de red transitorio (ECONNREFUSED)', async () => {
    const networkError = new Error('connect ECONNREFUSED 127.0.0.1:3010');
    const run = vi.fn()
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce(successJson);

    const provider = new SozuWalletProvider(run, { maxRetries: 3, baseDelayMs: 10 });

    const wallet = await provider.createWallet();

    expect(run).toHaveBeenCalledTimes(2);
    expect(wallet.address).toBe('GABC...');
  });

  it('agota los reintentos y lanza el último error si persiste', async () => {
    const run = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:3010'));

    const provider = new SozuWalletProvider(run, { maxRetries: 2, baseDelayMs: 10 });

    await expect(provider.createWallet()).rejects.toThrow('ECONNREFUSED');
    expect(run).toHaveBeenCalledTimes(3); // 1 inicial + 2 reintentos
  });

  it('no reintenta si el error no es recuperable (error de parseo)', async () => {
    const run = vi.fn().mockResolvedValue('no es json valido');

    const provider = new SozuWalletProvider(run, { maxRetries: 3, baseDelayMs: 10 });

    await expect(provider.createWallet()).rejects.toThrow(
      'No se encontró JSON en la salida de sozu-faucet',
    );
    expect(run).toHaveBeenCalledTimes(1);
  });
});
