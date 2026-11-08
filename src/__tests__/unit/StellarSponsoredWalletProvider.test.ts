import { describe, it, expect, vi } from 'vitest';
import { Keypair, Networks } from '@stellar/stellar-sdk';
import { StellarSponsoredWalletProvider } from '../../infrastructure/stellar/StellarSponsoredWalletProvider';

describe('StellarSponsoredWalletProvider (adaptador)', () => {
  it('crea una cuenta patrocinada con trustline USDC y devuelve Wallet', async () => {
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

    vi.spyOn(Keypair, 'fromSecret').mockReturnValue(sponsorKeypair as any);
    const randomSpy = vi.spyOn(Keypair, 'random').mockReturnValue(userKeypair as any);

    const provider = new StellarSponsoredWalletProvider(
      'SA_ANY_SECRET',
      'https://horizon-testnet.stellar.org',
      Networks.TESTNET,
      horizon,
    );

    const wallet = await provider.createWallet();

    expect(randomSpy).toHaveBeenCalledTimes(1);
    expect(wallet.address).toBe(userPublic);
    expect(wallet.secret).toBeDefined();
    expect(loadAccount).toHaveBeenCalledTimes(2); // sponsor, luego user
    expect(submitTransaction).toHaveBeenCalledTimes(2); // createAccount, changeTrust

    const secondTx = submitTransaction.mock.calls[1][0];
    expect(secondTx.signatures.length).toBeGreaterThanOrEqual(1);

    randomSpy.mockRestore();
    vi.spyOn(Keypair, 'fromSecret').mockRestore();
  });
});
