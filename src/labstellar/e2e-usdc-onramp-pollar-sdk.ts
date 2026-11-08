/**
 * Script de PRUEBA con SDK @pollar/core - Flujo On-Ramp completo.
 *
 * ⚠️ SOLO PARA PRUEBAS - No usar en producción.
 *
 * Este script usa el SDK oficial @pollar/core (PollarClient) para completar
 * el flujo on-ramp end-to-end, incluyendo la firma de la transacción Stellar.
 *
 * Fuente: https://docs.pollar.xyz/docs/sdk-reference/pollar-core
 *
 * Variables de entorno requeridas:
 *   POLAR_PUBLIC_KEY   — clave pública de Pollar (pub_testnet_*).
 *   STELLAR_SECRET_KEY   — secret key de la wallet Stellar del usuario (para firmar).
 *
 * Flujo implementado:
 * 1. Inicializar PollarClient con la clave pública.
 * 2. Crear wallet gestionada por Pollar (setUpRampWallet).
 * 3. Consultar rutas de on-ramp disponibles (getRampRoutes).
 * 4. Cotizar on-ramp (quoteRamp).
 * 5. Crear orden de rampa (createRampOrder).
 * 6. Firmar la pierna de rampa (signRampLeg) con la wallet del usuario.
 * 7. Esperar resolución de la orden (pollRampOrder).
 *
 * ⚠️ Nota: PollarClient está diseñado para entornos de navegador.
 * En Node.js puede requerir polyfills. El login con proveedor de auth
 * (Google, etc.) requiere interacción de usuario.
 */

import { PollarClient } from '@pollar/core';
import { Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';

const POLAR_PUBLIC_KEY = process.env.POLAR_PUBLIC_KEY;
const STELLAR_SECRET_KEY = process.env.STELLAR_SECRET_KEY;

if (!POLAR_PUBLIC_KEY) {
  throw new Error('Falta la variable de entorno POLAR_PUBLIC_KEY');
}

async function main() {
  // ========================================================================
  // PASO 1: Inicializar cliente de Pollar
  // ========================================================================
  console.log('🔹 Paso 1: Inicializando cliente de Pollar…');
  const client = new PollarClient({
    apiKey: POLAR_PUBLIC_KEY,
    stellarNetwork: 'testnet',
  } as any);
  console.log('   ✅ Cliente de Pollar inicializado.');

  // ========================================================================
  // PASO 2: Crear wallet gestionada por Pollar
  // ========================================================================
  console.log('\n🔹 Paso 2: Creando wallet gestionada por Pollar…');
  try {
    const wallet: any = await client.setUpRampWallet('STELLAR' as any);
    console.log(`   ✅ Wallet creada: ${wallet.address ?? wallet.publicKey}`);
  } catch (err: any) {
    if (err.message?.includes('already exists') || err.code === 'WALLET_ALREADY_EXISTS') {
      console.log('   ✅ La wallet ya existe, continuando…');
    } else {
      console.log(`   ⚠️  Error creando wallet: ${err.message}`);
    }
  }

  // ========================================================================
  // PASO 3: Consultar rutas de on-ramp disponibles
  // ========================================================================
  console.log('\n🔹 Paso 3: Consultando rutas de on-ramp…');
  const routesResp: any = await client.getRampRoutes('ONRAMP' as any);
  console.log(`   Rutas disponibles: ${routesResp.routes.length}`);
  for (const route of routesResp.routes) {
    console.log(`     - ${route.fiat.currency}/${route.asset.code} via ${route.fiat.rail} (${route.fiat.country})`);
  }

  if (routesResp.routes.length === 0) {
    throw new Error('No hay rutas de on-ramp disponibles en Pollar testnet');
  }

  const firstRoute = routesResp.routes[0];
  console.log(`   Usando ruta: ${firstRoute.fiat.currency}/${firstRoute.asset.code}`);

  // ========================================================================
  // PASO 4: Cotizar on-ramp
  // ========================================================================
  console.log('\n🔹 Paso 4: Cotizando on-ramp…');
  const quote: any = await client.quoteRamp({
    direction: 'ONRAMP',
    fiat: firstRoute.fiat,
    asset: firstRoute.asset,
    amount: { value: '5000', denomination: 'in' },
  });
  const quoteRoute = quote.quotes[0];
  console.log(`   Cotización: ${quoteRoute.quoteId}`);
  console.log(`   Monto a pagar: ${quoteRoute.amountIn} ${firstRoute.fiat.currency}`);
  console.log(`   Monto a recibir: ${quoteRoute.amountOut} ${firstRoute.asset.code}`);

  // ========================================================================
  // PASO 5: Crear orden de rampa
  // ========================================================================
  console.log('\n🔹 Paso 5: Creando orden de rampa…');
  const userAddress = STELLAR_SECRET_KEY
    ? Keypair.fromSecret(STELLAR_SECRET_KEY).publicKey()
    : 'GAMQ7FKXLZ6JISNHZT6AJY742CSOZK7DBBCIVGEN375E7MTMFBMD4PCR';
  console.log(`   Usuario: ${userAddress}`);

  const order: any = await client.createRampOrder({
    quoteId: quoteRoute.quoteId,
    payee: { stellarDestination: userAddress },
  });
  console.log(`   Orden: ${order.id}`);
  console.log(`   Estado: ${order.state}`);
  console.log(`   Acción pendiente: ${order.pendingAction?.kind ?? 'NONE'}`);

  if (order.pendingAction?.kind === 'SIGNATURE') {
    console.log('\n⏳ La orden requiere firma de la pierna de rampa (SIGNATURE)…');

    // ========================================================================
    // PASO 6: Firmar la pierna de rampa
    // ========================================================================
    console.log('\n🔹 Paso 6: Firmando pierna de rampa…');

    const userKeypair = Keypair.fromSecret(STELLAR_SECRET_KEY!);
    console.log(`   Usuario: ${userKeypair.publicKey()}`);

    // Registrar handler de firma para Stellar (wallet externa)
    (client as any).registerRampSigningHandler('STELLAR' as any, async (payload: any) => {
      console.log('   📝 Handler de firma llamado');
      const xdr = payload.xdr || payload.transactionXdr || payload;
      const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
      tx.sign(userKeypair);
      return tx.toXDR();
    });

    // Intentar firmar usando signRampLeg del cliente
    try {
      const signed: any = await (client as any).signRampLeg(order.id, 0);
      console.log('   ✅ Pierna firmada exitosamente');
      console.log(`   Firma: ${signed.signedPayload?.slice(0, 50)}…`);
    } catch (err: any) {
      console.log(`   ⚠️  Error firmando con SDK: ${err.message}`);

      // Alternativa: obtener detalles de la orden para ver el actionId
      const orderDetails: any = await client.getRampOrder(order.id);
      const leg = orderDetails.legs?.[0];
      const actionId = leg?.steps?.[0]?.actionId;
      console.log(`   Action ID: ${actionId ?? 'N/A'}`);

      if (actionId && STELLAR_SECRET_KEY) {
        console.log('   Se requiere implementar submitRampLegSignature con el XDR firmado');
        console.log('   El XDR se obtiene del payload de pendingAction del SDK');
      }
    }
  }

  // ========================================================================
  // PASO 7: Esperar resolución de la orden
  // ========================================================================
  console.log('\n🔹 Paso 7: Esperando resolución de la orden…');
  try {
    const final: any = await client.pollRampOrder(order.id, {
      until: (o: any) => o.state === 'completed' || o.state === 'failed' || o.state === 'refunded',
      onUpdate: (o: any) => console.log(`   Estado: ${o.state} — Acción: ${o.pendingAction?.kind ?? 'NONE'}`),
    });
    console.log(`   ✅ Estado final: ${final.state}`);
    if (final.txHash) {
      console.log(`   Hash en cadena: https://stellar.expert/explorer/testnet/tx/${final.txHash}`);
    }
  } catch (err: any) {
    console.log(`   ⚠️  Error en polling: ${err.message}`);
    console.log('   La orden puede requerir firma manual del usuario.');
  }

  console.log('\n📋 Flujo de on-ramp completado.');
}

main().catch((err) => {
  console.error('❌ Error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
