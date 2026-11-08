import { describe, it, expect, vi } from 'vitest';
import { Keypair, Networks } from '@stellar/stellar-sdk';
import { StellarSponsoredWalletProvider } from '../../infrastructure/stellar/StellarSponsoredWalletProvider';
import { SecretProvider } from '../../application/ports/SecretProvider';

describe('StellarSponsoredWalletProvider (adaptador)', () => {
  it('rechaza una clave secreta inválida', async () => {
    const secretProvider = {
      getSponsorSecret: vi.fn().mockResolvedValue('SA_INVALID_SECRET_TOO_SHORT'),
    } as unknown as SecretProvider;

    const provider = new StellarSponsoredWalletProvider(
      secretProvider,
      'https://horizon-testnet.stellar.org',
      Networks.TESTNET,
    );

    await expect(provider.createWallet()).rejects.toThrow(
      /Clave secreta Stellar inválida/,
    );
  });

  it('crea una cuenta patrocinada con trustline USDC vía sponsored reserves sandwich y devuelve Wallet', async () => {
    const sponsorKeypair = Keypair.random();
    const userKeypair = Keypair.random();
    const sponsorPublic = sponsorKeypair.publicKey();
    const userPublic = userKeypair.publicKey();

    const submitTransaction = vi.fn().mockResolvedValue({ success: true, hash: 'tx-hash' });
    const loadAccount = vi.fn()
      .mockResolvedValueOnce({
        sequence: '10',
        sequenceNumber: () => '10',
        incrementSequenceNumber: vi.fn(),
        accountId: () => sponsorPublic,
      } as any)
      .mockResolvedValueOnce({
        sequence: '0',
        sequenceNumber: () => '0',
        incrementSequenceNumber: vi.fn(),
        accountId: () => userPublic,
      } as any);

    const horizon = { loadAccount, submitTransaction } as any;

    // Mock del SecretProvider que devuelve el secreto del sponsor mockeado
    const secretProvider = {
      getSponsorSecret: vi.fn().mockResolvedValue(sponsorKeypair.secret()),
    } as unknown as SecretProvider;

    const randomSpy = vi.spyOn(Keypair, 'random').mockReturnValue(userKeypair as any);

    const provider = new StellarSponsoredWalletProvider(
      secretProvider,
      'https://horizon-testnet.stellar.org',
      Networks.TESTNET,
      horizon,
    );

    const wallet = await provider.createWallet();

    expect(randomSpy).toHaveBeenCalledTimes(1);
    expect(wallet.address).toBe(userPublic);
    expect(wallet.secret).toBeDefined();
    expect(loadAccount).toHaveBeenCalledTimes(2); // sponsor + usuario
    expect(submitTransaction).toHaveBeenCalledTimes(2); // createAccount + fee-bump

    randomSpy.mockRestore();
  });
});
