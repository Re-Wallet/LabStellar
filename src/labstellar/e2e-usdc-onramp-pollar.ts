/**
 * Script de validación E2E: `npm run e2e:usdc-onramp-pollar`.
 *
 * Flujo on-ramp (fiat → cripto) vía Pollar Server API v3.
 *
 * Arquitectura NO-CUSTODIAL: el usuario usa SU propia wallet Stellar.
 * Para que funcione, debes agregar los trustlines de los activos de las rutas
 * a tu wallet antes de ejecutar (o dejar que el script los agregue si tienes el secret).
 *
 * Fuente: https://docs.pollar.xyz/docs/sdk-reference/pollar-core
 *
 * Variables de entorno requeridas:
 *   SPONSOR_SECRET_KEY — secret key de la cuenta sponsor (fee-bump de Stellar).
 *   POLAR_SECRET_KEY   — clave secreta de Pollar (sec_testnet_* / sec_mainnet_*).
 *   POLAR_EXTERNAL_USER_ID — id de usuario externo para Pollar.
 *   STELLAR_SECRET_KEY   — (opcional) tu secret key de wallet Stellar existente.
 *                          Si no se define, se crea una wallet aleatoria (no podrás
 *                          agregar trustlines manualmente).
 *
 * Nota: los secretos solo se manejan en memoria, nunca se hardcodean.
 */
import {
  Keypair,
  Networks,
  Asset,
  TransactionBuilder,
  Horizon,
  Operation,
} from '@stellar/stellar-sdk';
import { StellarPaymentSubmitter } from '../infrastructure/stellar/StellarPaymentSubmitter';
import { SendSponsoredPayment } from '../application/use-cases/SendSponsoredPayment';
import { EnvSecretProvider } from '../infrastructure/secret/EnvSecretProvider';
import { PollarRampProvider } from '../infrastructure/pollar/PollarRampProvider';
import { CreateOnRampQuote } from '../application/use-cases/CreateOnRampQuote';
import { ExecuteOnRampOrder } from '../application/use-cases/ExecuteOnRampOrder';

const HORIZON_URL = 'https://horizon-testnet.stellar.org';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno ${name}`);
  }
  return value;
}

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

async function addTrustline(
  server: Horizon.Server,
  secret: string,
  address: string,
  asset: Asset,
): Promise<void> {
  const keypair = Keypair.fromSecret(secret);
  const account = await server.loadAccount(address);

  const hasTrustline = account.balances.some(
    (b) =>
      (b.asset_type === 'credit_alphanum4' || b.asset_type === 'credit_alphanum12') &&
      b.asset_code === asset.getCode() &&
      b.asset_issuer === asset.getIssuer(),
  );

  if (hasTrustline) {
    console.log(`   ✅ Trustline ${asset.getCode()}:${asset.getIssuer()} ya existe.`);
    return;
  }

  const tx = new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.changeTrust({ asset }))
    .setTimeout(60)
    .build();

  tx.sign(keypair);
  await server.submitTransaction(tx);
  console.log(`   ✅ Trustline ${asset.getCode()}:${asset.getIssuer()} añadida.`);
}

async function main() {
  const sponsorSecretProvider = new EnvSecretProvider('SPONSOR_SECRET_KEY');
  const polarSecretProvider = new EnvSecretProvider('POLAR_SECRET_KEY');

  const externalUserId = process.env.POLAR_EXTERNAL_USER_ID || 'rewallet-lab-stellar';
  const stellarSecretProvider = new EnvSecretProvider('STELLAR_SECRET_KEY');
  const polarProvider = new PollarRampProvider(
    polarSecretProvider,
    stellarSecretProvider,
    externalUserId,
  );

  const quoteUseCase = new CreateOnRampQuote(polarProvider);
  const orderUseCase = new ExecuteOnRampOrder(polarProvider);

  // 1. Usar wallet existente o crear una nueva.
  let walletA: Keypair;
  const existingSecret = process.env.STELLAR_SECRET_KEY;

  if (existingSecret) {
    console.log('🔹 Usando wallet Stellar existente…');
    walletA = Keypair.fromSecret(existingSecret);
    console.log(`   Dirección: ${walletA.publicKey()}`);
  } else {
    console.log('🔹 Creando wallet nueva (aleatoria)…');
    walletA = Keypair.random();
    console.log(`   Dirección: ${walletA.publicKey()}`);
    console.log(`   ⚠️  SECRET (guárdalo): ${walletA.secret()}`);
    console.log('   ⚠️  Sin STELLAR_SECRET_KEY no podrás agregar trustlines manualmente.');
  }

  const server = new Horizon.Server(HORIZON_URL);
  const aAccount = await waitForAccount(server, walletA.publicKey());
  console.log(`   ✅ Wallet existe en Horizon (XLM: ${aAccount.balances.find(b => b.asset_type === 'native')?.balance ?? '0'}).`);

  // 2. Vincular wallet (no-custodial) al usuario en Pollar.
  console.log('\n🔹 Vinculando wallet con Pollar (wallet externa)…');
  await polarProvider.linkWallet('STELLAR', walletA.publicKey());
  console.log(`   ✅ Wallet ${walletA.publicKey()} vinculada como EXTERNAL.`);

  // 3. Consultar rutas de on-ramp disponibles en Pollar.
  console.log('\n🔹 Consultando rutas de on-ramp disponibles en Pollar…');
  const routesResp = await polarProvider.getRampRoutes('on');
  console.log(`   Rutas disponibles: ${routesResp.routes.length}`);
  for (const route of routesResp.routes) {
    console.log(`     - ${route.fiat.currency}/${route.asset.code} via ${route.fiat.rail} (${route.fiat.country})`);
    console.log(`       asset issuer: ${route.asset.identifier ?? 'N/A'}`);
  }

  if (routesResp.routes.length === 0) {
    throw new Error('No hay rutas de on-ramp disponibles en Pollar testnet');
  }

  // 4. Agregar trustlines de todos los activos de las rutas.
  console.log('\n🔹 Agregando trustlines de todos los activos de las rutas…');
  const addedAssets = new Set<string>();
  for (const route of routesResp.routes) {
    const issuer = route.asset.identifier;
    if (!issuer) {
      console.log(`     ⚠️  Saltando ${route.asset.code} sin issuer`);
      continue;
    }
    const key = `${route.asset.code}:${issuer}`;
    if (addedAssets.has(key)) {
      continue;
    }
    addedAssets.add(key);
    const asset = new Asset(route.asset.code, issuer);
    await addTrustline(server, walletA.secret(), walletA.publicKey(), asset);
  }

  if (!existingSecret) {
    console.log('\n⚠️  IMPORTANTE: Como usaste una wallet aleatoria, Pollar no puede verificar');
    console.log('   los trustlines que se agregaron arriba (no son de tu wallet real).');
    console.log('   Para probar el on-ramp completo, necesitas:');
    console.log('   1. Tener una wallet Stellar propia con su secret key.');
    console.log('   2. Agregar los trustlines de COP, ARS y PEN a esa wallet.');
    console.log('   3. Ejecutar con STELLAR_SECRET_KEY configurada.');
    console.log('\n   Trustlines que necesitas agregar a tu wallet:');
    for (const route of routesResp.routes) {
      if (route.asset.identifier) {
        console.log(`     - ${route.asset.code}:${route.asset.identifier}`);
      }
    }
    process.exit(0);
  }

  // 5. Cotizar on-ramp usando la primera ruta disponible.
  console.log('\n🔹 Cotizando on-ramp usando la primera ruta disponible…');
  const firstRoute = routesResp.routes[0];
  const quote = await quoteUseCase.execute({
    direction: 'on',
    fiat: firstRoute.fiat,
    asset: { code: firstRoute.asset.code, identifier: firstRoute.asset.identifier ?? undefined, chain: 'STELLAR' },
    amount: { value: '5000', denomination: 'in' },
  });
  console.log(`   Cotización obtenida: ${quote.quotes[0]?.quoteId ?? 'N/A'}`);
  console.log(`   Rutas disponibles: ${quote.quotes.length}`);
  console.log(`   Monto a pagar: ${quote.quotes[0]?.amountIn ?? 'N/A'} ${firstRoute.fiat.currency}`);
  console.log(`   Monto a recibir: ${quote.quotes[0]?.amountOut ?? 'N/A'} ${firstRoute.asset.code}`);
  if (quote.rejected && quote.rejected.length > 0) {
    console.log(`   Rutas rechazadas: ${quote.rejected.length}`);
    for (const rej of quote.rejected) {
      console.log(`     - ${rej.routeId}: ${rej.reason}`);
    }
  }
  if (quote.quotes.length > 0) {
    const firstQuoteRoute = quote.quotes[0];
    const firstLeg = firstQuoteRoute.legs[0];
    console.log(`   ETA: ${firstQuoteRoute.etaSeconds ?? 'N/A'}s`);
    console.log(`   Expira: ${firstQuoteRoute.expiresAt ?? 'N/A'}`);
    console.log(`   Comisión proveedor: ${firstLeg.providerFees?.[0]?.amount ?? 'N/A'} ${firstLeg.providerFees?.[0]?.currency ?? ''}`);
    if (firstQuoteRoute.requiredFields && firstQuoteRoute.requiredFields.length > 0) {
      console.log(`   Campos requeridos por la ruta:`);
      for (const field of firstQuoteRoute.requiredFields) {
        console.log(`     - ${field.key} (${field.type}, requerido: ${field.required})`);
      }
    }
  }

  // 6. Crear orden de on-ramp con payee (dirección Stellar del usuario).
  console.log('\n🔹 Creando orden de on-ramp vía Pollar…');
  const payee: Record<string, any> = {
    stellarDestination: walletA.publicKey(),
  };
  const quoteFirstRoute = quote.quotes[0];
  if (!quoteFirstRoute?.quoteId) {
    throw new Error('No se pudo obtener quoteId de la cotización');
  }
  if (quoteFirstRoute?.requiredFields) {
    for (const field of quoteFirstRoute.requiredFields) {
      if (!(field.key in payee)) {
        payee[field.key] = '';
      }
    }
  }

  const order = await orderUseCase.execute({
    quoteId: quoteFirstRoute.quoteId,
    payee,
  });
  console.log(`   Orden creada: ${order.id}`);
  console.log(`   Estado: ${order.state}`);
  console.log(`   Piernas: ${order.legs.length}`);
  if (order.pendingAction) {
    console.log(`   Acción pendiente: ${order.pendingAction.kind}`);
    console.log(`   Instrucciones: ${order.pendingAction.instructions ?? 'N/A'}`);
  }
  if (order.txHash) {
    console.log(`   Hash en cadena: ${order.txHash}`);
  }

  // 6. Firmar la pierna de rampa si hay una acción pendiente de tipo SIGNATURE.
  if (order.pendingAction?.kind === 'SIGNATURE') {
    console.log('\n🔹 Firmando pierna de rampa (SIGNATURE)…');
    try {
      const signedOrder = await polarProvider.signRampLeg(order.id, 0);
      console.log(`   ✅ Pierna firmada. Nueva estado: ${signedOrder.state}`);
      console.log(`   Nueva acción pendiente: ${signedOrder.pendingAction?.kind ?? 'NONE'}`);
      if (signedOrder.txHash) {
        console.log(`   Hash en cadena: ${signedOrder.txHash}`);
      }
    } catch (err: any) {
      console.log(`   ❌ Error firmando: ${err.message}`);
      console.log('   Continuando con polling...');
    }
  }

  // 6b. Iniciar KYC si la acción pendiente es de tipo KYC.
  if (order.pendingAction?.kind === 'KYC' || (order.pendingAction?.kind === 'NONE' && false)) {
    // No hacer nada aquí, se maneja después del firma
  }

  // 6c. Si después de firmar (o si ya estaba) hay KYC pendiente, iniciarlo.
  const orderAfterSign = order.pendingAction?.kind === 'SIGNATURE' 
    ? await polarProvider.getOrderStatus(order.id) 
    : order;

  if (orderAfterSign.pendingAction?.kind === 'KYC') {
    console.log('\n🔹 Iniciando sesión KYC (Full Verification: ID + selfie + address + sanctions + device)…');
    const kycPayload = orderAfterSign.pendingAction.payload ?? {};
    const corridorId = kycPayload.corridorId;
    const providerId = kycPayload.providerId ?? '';

    if (!corridorId || !providerId) {
      console.log(`   ⚠️  No se pudo obtener corridorId o providerId del KYC.`);
      console.log(`   Payload:`, JSON.stringify(kycPayload, null, 2));
    } else {
      try {
        const kycStatus = await polarProvider.startKyc({
          providerId,
          corridorId,
          idempotencyKey: `kyc-${order.id}-${Date.now()}`,
        });
        console.log(`   ✅ Sesión KYC iniciada.`);
        console.log(`   URL de KYC: ${kycStatus.kycUrl ?? 'N/A'}`);
        console.log(`   Estado: ${kycStatus.status}`);
        console.log(`   Corridor ID: ${kycStatus.corridorId}`);
        console.log(`   Provider ID: ${kycStatus.providerId}`);
        console.log(`   Expira: ${kycStatus.expiresAt ?? 'N/A'}`);

        if (kycStatus.kycUrl) {
          console.log('\n⚠️  ACCIÓN REQUERIDA DEL USUARIO:');
          console.log(`   Visita esta URL para completar la verificación KYC:`);
          console.log(`   ${kycStatus.kycUrl}`);
          console.log('   Después de completar, el KYC se aprobará automáticamente.');
        }

        // 6d. Hacer polling del estado KYC hasta que se apruebe.
        console.log('\n🔹 Esperando aprobación del KYC (polling)…');
        let kycAttempts = 0;
        const maxKycAttempts = 60; // 5 minutos máximo (5s * 60 = 300s)

        while (kycAttempts < maxKycAttempts) {
          kycAttempts++;
          await new Promise((r) => setTimeout(r, 5000));
          const currentKyc = await polarProvider.getKycStatus(corridorId);
          console.log(`   Intento ${kycAttempts}: estado KYC = ${currentKyc.status}`);

          if (currentKyc.status === 'approved') {
            console.log('   ✅ KYC aprobado!');
            break;
          } else if (currentKyc.status === 'rejected') {
            console.log(`   ❌ KYC rechazado: ${currentKyc.reason ?? 'sin razón'}`);
            console.log(`   Campos faltantes: ${currentKyc.missingFields?.join(', ') ?? 'N/A'}`);
            break;
          } else if (currentKyc.status === 'expired') {
            console.log('   ⏰ KYC expirado.');
            break;
          }
          // Si sigue en 'pending' o 'none', continuar polling
        }

        if (kycAttempts >= maxKycAttempts) {
          console.log('   ⏱️  Se alcanzó el máximo de intentos de KYC polling.');
        }
      } catch (err: any) {
        console.log(`   ❌ Error iniciando o consultando KYC: ${err.message}`);
      }
    }
  }

  // 7. Poll del estado de la orden hasta que se resuelva.
  console.log('\n🔹 Esperando resolución de la orden (polling)…');
  let currentOrder = order;
  let attempts = 0;
  const maxAttempts = 20;

  while (
    currentOrder.state === 'created' ||
    currentOrder.state === 'awaiting_payment' ||
    currentOrder.state === 'processing' ||
    currentOrder.state === 'settling_onchain'
  ) {
    attempts++;
    if (attempts > maxAttempts) {
      console.log(`   ⏱️  Se alcanzó el máximo de intentos de polling (${maxAttempts}).`);
      break;
    }

    await new Promise((r) => setTimeout(r, 5000));
    currentOrder = await polarProvider.getOrderStatus(currentOrder.id);
    console.log(`   Intento ${attempts}: estado = ${currentOrder.state}`);
    if (currentOrder.pendingAction) {
      console.log(`   Acción pendiente: ${currentOrder.pendingAction.kind} — ${currentOrder.pendingAction.instructions ?? ''}`);
    }
    if (currentOrder.txHash) {
      console.log(`   Hash en cadena: ${currentOrder.txHash}`);
    }
  }

  console.log(`\n📋 Estado final de la orden: ${currentOrder.state}`);
  if (currentOrder.txHash) {
    console.log(`   Hash: https://stellar.expert/explorer/testnet/tx/${currentOrder.txHash}`);
  }

  if (currentOrder.state === 'completed') {
    console.log('\n✅ On-ramp completado con éxito.');
  } else if (currentOrder.state === 'failed' || currentOrder.state === 'refunded') {
    console.log(`\n⚠️  On-ramp terminó con estado: ${currentOrder.state}`);
  } else {
    console.log(`\n⏳ On-ramp aún en proceso (estado: ${currentOrder.state}). Revisar manualmente.`);
  }
}

main().catch((err) => {
  console.error('❌ Demo falló:', err instanceof Error ? err.message : err);
  process.exit(1);
});
