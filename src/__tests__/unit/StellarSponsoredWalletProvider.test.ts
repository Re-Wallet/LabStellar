import { describe, it, expect, vi } from 'vitest';
import { Keypair, Networks } from '@stellar/stellar-sdk';
import { StellarSponsoredWalletProvider } from '../../infrastructure/stellar/StellarSponsoredWalletProvider';

describe('StellarSponsoredWalletProvider (adaptador)', () => {
  it('rechaza una clave secreta inválida', () => {
    expect(() => {
      new StellarSponsoredWalletProvider(
        'SA_INVALID_SECRET_TOO_SHORT',
        'https://horizon-testnet.stellar.org',
        Networks.TESTNET,
      );
    }).toThrow(/Clave secreta Stellar inválida/);
  });

  it('crea una cuenta patrocinada con trustline USDC vía sponsored reserves sandwich y devuelve Wallet', async () => {
    const sponsorKeypair = Keypair.random();
    const userKeypair = Keypair.random();
    const sponsorPublic = sponsorKeypair.publicKey();
    const userPublic = userKeypair.publicKey();

    const submitTransaction = vi.fn().mockResolvedValue({ success: true, hash: 'tx-hash' });
    const loadAccount = vi.fn().mockResolvedValue({
      sequence: '10',
      sequenceNumber: () => '10',
      incrementSequenceNumber: vi.fn(),
      accountId: () => sponsorPublic,
    } as any);

    const horizon = { loadAccount, submitTransaction } as any;

    vi.spyOn(Keypair, 'fromSecret').mockReturnValue(sponsorKeypair as any);
    const randomSpy = vi.spyOn(Keypair, 'random').mockReturnValue(userKeypair as any);

    const provider = new StellarSponsoredWalletProvider(
      sponsorKeypair.secret(),
      'https://horizon-testnet.stellar.org',
      Networks.TESTNET,
      horizon,
    );

    const wallet = await provider.createWallet();

    expect(randomSpy).toHaveBeenCalledTimes(1);
    expect(wallet.address).toBe(userPublic);
    expect(wallet.secret).toBeDefined();
    expect(loadAccount).toHaveBeenCalledTimes(1); // sponsor account para sequence
    expect(submitTransaction).toHaveBeenCalledTimes(1); // fee-bump envuelto

    randomSpy.mockRestore();
    vi.spyOn(Keypair, 'fromSecret').mockRestore();
  });
});
