// netlify/functions/stripe-webhook.js
//
// Co robi ta funkcja:
// 1. Stripe wysyła tu powiadomienie (webhook), gdy klient opłaci zamówienie.
// 2. Funkcja sprawdza, który plan został kupiony (po Price ID ze Stripe).
// 3. Wysyła klientowi e-mail z linkiem do pobrania planu (przez Resend).
//
// Wymagane zmienne środowiskowe (ustawiane w Netlify: Site settings -> Environment variables):
//   STRIPE_SECRET_KEY      - klucz sekretny Stripe (Developers -> API keys)
//   STRIPE_WEBHOOK_SECRET  - podpis webhooka (Developers -> Webhooks -> Twój endpoint -> Signing secret)
//   RESEND_API_KEY         - klucz API z Resend (resend.com)

const Stripe = require('stripe');
const { Resend } = require('resend');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

// 🔧 PODMIEŃ: uzupełnij prawdziwymi Price ID ze Stripe (Products -> [plan] -> Pricing)
// i prawdziwymi linkami do plików z planami (np. link do pliku w Google Drive/Dysku
// z dostępem "każdy z linkiem", albo plik wrzucony do repo/Netlify i podlinkowany bezpośrednio).
const PLANS = {
  'price_PODMIEN_REDUKCJA': {
    name: 'Plan na redukcję',
    downloadUrl: 'https://twoja-domena.pl/pliki/plan-redukcja.pdf'
  },
  'price_PODMIEN_MASA': {
    name: 'Plan na masę',
    downloadUrl: 'https://twoja-domena.pl/pliki/plan-masa.pdf'
  },
  'price_PODMIEN_SILA_DIETA': {
    name: 'Plan + dieta',
    downloadUrl: 'https://twoja-domena.pl/pliki/plan-sila-dieta.pdf'
  }
};

exports.handler = async (event) => {
  const signature = event.headers['stripe-signature'];
  let stripeEvent;

  // Weryfikacja, że żądanie faktycznie przyszło ze Stripe (bezpieczeństwo)
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Nieprawidłowy podpis webhooka:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  if (stripeEvent.type !== 'checkout.session.completed') {
    // Interesuje nas tylko zakończona i opłacona sesja - resztę ignorujemy
    return { statusCode: 200, body: 'ignored' };
  }

  const session = stripeEvent.data.object;

  try {
    // Pobieramy pełne dane sesji razem z kupionymi pozycjami (line_items)
    const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
      expand: ['line_items']
    });

    const customerEmail = fullSession.customer_details?.email;
    const lineItems = fullSession.line_items?.data || [];

    if (!customerEmail) {
      console.error('Brak adresu e-mail klienta w sesji', session.id);
      return { statusCode: 200, body: 'no email' };
    }

    const purchasedPlans = lineItems
      .map((item) => PLANS[item.price?.id])
      .filter(Boolean);

    if (purchasedPlans.length === 0) {
      console.error('Nie rozpoznano kupionego planu (sprawdź mapowanie PLANS) dla sesji', session.id);
      return { statusCode: 200, body: 'no matching plan' };
    }

    const linksHtml = purchasedPlans
      .map((p) => `<li style="margin-bottom:8px;"><a href="${p.downloadUrl}" style="color:#131018;font-weight:700;">${p.name} — pobierz plan</a></li>`)
      .join('');

    await resend.emails.send({
      // 🔧 PODMIEŃ: adres nadawcy musi być z domeny zweryfikowanej w Resend
      from: 'Adrian Michna <plany@twoja-domena.pl>',
      to: customerEmail,
      subject: 'Twój plan treningowy jest gotowy 💪',
      html: `
        <div style="font-family: sans-serif; line-height:1.6; max-width:480px; margin:0 auto;">
          <h2 style="font-family:sans-serif;">Dziękuję za zakup!</h2>
          <p>Poniżej znajdziesz link(i) do pobrania:</p>
          <ul style="padding-left:18px;">${linksHtml}</ul>
          <p>Powodzenia w treningach!<br>Adrian Michna</p>
        </div>
      `
    });

    console.log('Wysłano plan(y) na adres:', customerEmail);
    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    console.error('Błąd podczas przetwarzania zakupu:', err);
    return { statusCode: 500, body: 'internal error' };
  }
};
