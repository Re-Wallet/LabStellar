import { describe, it, expect } from 'vitest';
import {
  Keypair,
  Networks,
  Asset,
  TransactionBuilder,
  Horizon,
  Operation,
} from '@stellar/stellar-sdk';
import { SozuWalletProvider } from '../../infrastructure/sozu/SozuWalletProvider';
import { StellarPaymentSubmitter } from '../../infrastructure/stellar/StellarPaymentSubmitter';
import { CreateFundedWallet } from '../../application/use-cases/CreateFundedWallet';
import { SendSponsoredPayment } from '../../application/use-cases/SendSponsoredPayment';
import { EnvSecretProvider } from '../../infrastructure/secret/EnvSecretProvider';

const HORIZON_URL = 'https://horizon-testnet.stellar.org';
const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const USDC = new Asset('USDC', USDC_ISSUER);

const e2e = process.env.E2E === 'true' && !!process.env.SPONSOR_SECRET_KEY;
const sponsorSecretProvider = new EnvSecretProvider('SPONSOR_SECRET_KEY');

const itE2E = e2e ? it : it.skip;

describe('fee-bump E2E (Testnet)', () => {
  itE2E(
    'envía un pago USDC patrocinado y verifica que la fee la paga el sponsor',
    async () => {
      const server = new Horizon.Server(HORIZON_URL);

      // 1. Wallet A vía Sozu (Friendbot + trustline + claim USDC).
      const walletProvider = new SozuWalletProvider();
      const createWallet = new CreateFundedWallet(walletProvider);
      const walletA = await createWallet.execute();
      expect(walletA.address).toMatch(/^G/);
      expect(walletA.secret).toBeDefined();

      // 2. Wallet B (destinatario): Friendbot + trustline USDC.
      const walletB = Keypair.random();
      await fetch(
        `https://friendbot.stellar.org?addr=${encodeURIComponent(
          walletB.publicKey(),
        )}`,
      );
      const bAccount = await waitForAccount(server, walletB.publicKey());

      const trustlineTx = new TransactionBuilder(bAccount, {
        fee: '100',
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(Operation.changeTrust({ asset: USDC }))
        .setTimeout(60)
        .build();
      trustlineTx.sign(walletB);
      await server.submitTransaction(trustlineTx);

      // 3. Pago USDC de A → B firmado por A.
      const sourceKeypair = Keypair.fromSecret(walletA.secret!);
      const sourceAccount = await server.loadAccount(walletA.address);
      const paymentTx = new TransactionBuilder(sourceAccount, {
        fee: '100',
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(
          Operation.payment({
            destination: walletB.publicKey(),
            asset: USDC,
            amount: '1',
          }),
        )
        .setTimeout(300)
        .build();
      paymentTx.sign(sourceKeypair);
      const xdr = paymentTx.toXDR();

      // 4. Fee-bump: el sponsor paga la comisión.
      const sponsorSecret = await sponsorSecretProvider.getSponsorSecret();
      const submitter = new StellarPaymentSubmitter(sponsorSecret, HORIZON_URL);
      const sendPayment = new SendSponsoredPayment(submitter);
      const hash = await sendPayment.execute(xdr);
      expect(hash).toMatch(/^[a-f0-9]{64}$/);

      // 5. Verificar la transacción en Horizon: exitosa y fee cobrada.
      const tx = await server.transactions().transaction(hash).call();
      expect(tx.successful).toBe(true);
      expect(Number(tx.fee_charged || 0)).toBeGreaterThan(0);

      // 6. El fee_account (pagador de la comisión) debe ser el sponsor.
      const sponsor = Keypair.fromSecret(sponsorSecret);
      expect(tx.source_account).toBe(sponsor.publicKey());
    },
    300_000,
  );
});

async function waitForAccount(
  server: Horizon.Server,
  address: string,
): Promise<Horizon.AccountResponse> {
  let account: Horizon.AccountResponse | undefined;
  for (let i = 0; i < 30; i++) {
    try {
      account = await server.loadAccount(address);
      return account;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`La cuenta ${address} no apareció en Horizon`);
}
