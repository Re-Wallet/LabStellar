import { describe, it, expect, vi } from 'vitest';
import { Keypair, Networks } from '@stellar/stellar-sdk';
import { StellarPaymentSubmitter } from '../../infrastructure/stellar/StellarPaymentSubmitter';

describe('StellarPaymentSubmitter (adaptador)', () => {
  const sponsorSecret = 'SABCSPONSOR...';
  const networkPassphrase = Networks.TESTNET;

  it('envuelve el XDR en fee-bump, firma con el sponsor y devuelve el hash', async () => {
    const submitTransaction = vi.fn().mockResolvedValue({ hash: 'txhash-fee-bump' });
    const horizon = { submitTransaction } as any;

    const provider = new StellarPaymentSubmitter(
      sponsorSecret,
      'https://horizon-testnet.stellar.org',
      networkPassphrase,
      horizon,
    );

    const hash = await provider.submitWithSponsor('AAAA...validXDR...');

    expect(hash).toBe('txhash-fee-bump');
    expect(submitTransaction).toHaveBeenCalledTimes(1);
  });

  it('lanza error si el submit de Horizon falla', async () => {
    const submitTransaction = vi.fn().mockRejectedValue(new Error('Horizon error'));
    const horizon = { submitTransaction } as any;

    const provider = new StellarPaymentSubmitter(
      sponsorSecret,
      'https://horizon-testnet.stellar.org',
      networkPassphrase,
      horizon,
    );

    await expect(provider.submitWithSponsor('AAAA...validXDR...')).rejects.toThrow(
      'Horizon error',
    );
  });
});
