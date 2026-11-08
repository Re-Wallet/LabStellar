import { describe, it, expect, vi } from 'vitest';
import { SendSponsoredPayment } from '../../application/use-cases/SendSponsoredPayment';
import { PaymentSubmitter } from '../../application/ports/PaymentSubmitter';

describe('SendSponsoredPayment (caso de uso)', () => {
  it('envía el XDR al submitter y devuelve el hash', async () => {
    const submitter: PaymentSubmitter = {
      submitWithSponsor: vi.fn().mockResolvedValue('txhash123'),
    };

    const useCase = new SendSponsoredPayment(submitter);
    const hash = await useCase.execute('AAAA...XDR');

    expect(hash).toBe('txhash123');
    expect(submitter.submitWithSponsor).toHaveBeenCalledWith('AAAA...XDR');
  });

  it('lanza error si no hay XDR', async () => {
    const submitter: PaymentSubmitter = {
      submitWithSponsor: vi.fn(),
    };
    const useCase = new SendSponsoredPayment(submitter);

    await expect(useCase.execute('')).rejects.toThrow('txXdr es requerido');
    await expect(useCase.execute(undefined as any)).rejects.toThrow('txXdr es requerido');
    expect(submitter.submitWithSponsor).not.toHaveBeenCalled();
  });
});
