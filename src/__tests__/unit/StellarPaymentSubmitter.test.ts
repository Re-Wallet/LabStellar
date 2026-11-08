import { describe, it, expect, vi } from 'vitest';

// Mock de @stellar/stellar-sdk para evitar construir cuentas Stellar reales en tests unitarios.
vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@stellar/stellar-sdk')>();
  return {
    ...actual,
    TransactionBuilder: {
      ...actual.TransactionBuilder,
      fromXDR: vi.fn().mockReturnValue({}),
      buildFeeBumpTransaction: vi.fn().mockReturnValue({
        sign: vi.fn(),
      }),
    },
    Keypair: {
      ...actual.Keypair,
      fromSecret: vi.fn().mockReturnValue({ publicKey: () => 'GCSPONSOR...' }),
    },
  };
});

import {
  TransactionBuilder,
  Keypair,
} from '@stellar/stellar-sdk';
import { StellarPaymentSubmitter } from '../../infrastructure/stellar/StellarPaymentSubmitter';

describe('StellarPaymentSubmitter (adaptador)', () => {
  const sponsorSecret = 'SABCSPONSOR...';
  const networkPassphrase = 'Test SDF Network ; September 2015';

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
    expect(TransactionBuilder.fromXDR).toHaveBeenCalledWith(
      'AAAA...validXDR...',
      networkPassphrase,
    );
    expect(TransactionBuilder.buildFeeBumpTransaction).toHaveBeenCalledTimes(1);
    expect(Keypair.fromSecret).toHaveBeenCalledWith(sponsorSecret);
    expect(submitTransaction).toHaveBeenCalledTimes(1);
  });
});
