import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Script from "next/script";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://homevalue.nexdoor.sg"),
  title: "Free Property Valuation Singapore | HDB, Condo & Landed | NexDoor",
  description:
    "Get a free instant property valuation in Singapore using recent HDB and URA transaction data. Estimate the value of your HDB, condo, EC or landed home before you sell.",
  openGraph: {
    title: "Free Property Valuation Singapore | HDB, Condo & Landed | NexDoor",
    description:
      "Get a free instant property valuation in Singapore using recent HDB and URA transaction data. Estimate the value of your HDB, condo, EC or landed home before you sell.",
    url: "https://homevalue.nexdoor.sg",
    siteName: "HomeValue by NexDoor",
    locale: "en_SG",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Free Property Valuation Singapore | HDB, Condo & Landed | NexDoor",
    description:
      "Get a free instant property valuation in Singapore using recent HDB and URA transaction data. Estimate the value of your HDB, condo, EC or landed home before you sell.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Script id="meta-pixel" strategy="afterInteractive">
          {`
            !function(f,b,e,v,n,t,s)
            {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};
            if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
            n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];
            s.parentNode.insertBefore(t,s)}(window, document,'script',
            'https://connect.facebook.net/en_US/fbevents.js');
            fbq('init', '947297821608514');
            fbq('track', 'PageView');
          `}
        </Script>
        <Script id="homevalue-lead-modal-experiment" strategy="afterInteractive">
          {`
            (function () {
              var TARGET_PATHS = ['/', '/free-property-valuation-singapore'];
              var STANDARD_UNLOCK_CTA = 'Unlock Full Home Value';
              var currentPath = window.location.pathname.replace(/\/$/, '') || '/';
              if (TARGET_PATHS.indexOf(currentPath) === -1) return;

              var autoClicked = false;
              var autoClickTimer = null;

              function normaliseText(value) {
                return (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
              }

              function isUnlockButtonText(text) {
                return text === 'view full report' ||
                  text === 'view my full report' ||
                  text === 'unlock full report' ||
                  text === 'unlock my full report' ||
                  text === 'see full home value' ||
                  text === 'see my full home value' ||
                  text === 'unlock full home value' ||
                  text === 'unlock my full home value';
              }

              function hideMaybeLaterOptions() {
                var clickableElements = document.querySelectorAll('button, a');
                clickableElements.forEach(function (element) {
                  var text = normaliseText(element.textContent);
                  if (text === 'maybe later' || text === 'maybe later.') {
                    element.style.display = 'none';
                    element.setAttribute('aria-hidden', 'true');
                    element.setAttribute('tabindex', '-1');
                  }
                });
              }

              function standardiseUnlockButtons() {
                var buttons = Array.prototype.slice.call(document.querySelectorAll('button'));
                buttons.forEach(function (button) {
                  var text = normaliseText(button.textContent);
                  if (isUnlockButtonText(text) && button.textContent.trim() !== STANDARD_UNLOCK_CTA) {
                    button.textContent = STANDARD_UNLOCK_CTA;
                  }
                });
              }

              function findViewFullReportButton() {
                var buttons = Array.prototype.slice.call(document.querySelectorAll('button'));
                return buttons.find(function (button) {
                  if (button.disabled) return false;
                  var text = normaliseText(button.textContent);
                  return isUnlockButtonText(text);
                });
              }

              function isLeadModalAlreadyOpen() {
                var bodyText = normaliseText(document.body ? document.body.textContent : '');
                return bodyText.indexOf('enter your details') !== -1 ||
                  bodyText.indexOf('contact details') !== -1 ||
                  bodyText.indexOf('unlock your full report') !== -1 ||
                  bodyText.indexOf('unlock my full report') !== -1 ||
                  bodyText.indexOf('unlock your full home value') !== -1 ||
                  bodyText.indexOf('unlock my full home value') !== -1;
              }

              function scheduleAutoOpenLeadModal() {
                hideMaybeLaterOptions();
                standardiseUnlockButtons();
                if (autoClicked || autoClickTimer || isLeadModalAlreadyOpen()) return;

                var button = findViewFullReportButton();
                if (!button) return;

                autoClickTimer = window.setTimeout(function () {
                  autoClickTimer = null;
                  hideMaybeLaterOptions();
                  standardiseUnlockButtons();
                  if (autoClicked || isLeadModalAlreadyOpen()) return;

                  var latestButton = findViewFullReportButton();
                  if (!latestButton) return;

                  autoClicked = true;
                  latestButton.click();
                  window.setTimeout(function () {
                    hideMaybeLaterOptions();
                    standardiseUnlockButtons();
                  }, 50);
                  window.setTimeout(function () {
                    hideMaybeLaterOptions();
                    standardiseUnlockButtons();
                  }, 250);
                }, 900);
              }

              function resetAutoClickWhenGeneratingAgain(event) {
                var target = event.target;
                if (!target || !target.closest) return;

                var clickedButton = target.closest('button');
                if (!clickedButton) return;

                var text = normaliseText(clickedButton.textContent);
                if (
                  text.indexOf('generate') !== -1 ||
                  text.indexOf('calculate') !== -1 ||
                  text.indexOf('estimate') !== -1 ||
                  text.indexOf('get my') !== -1
                ) {
                  autoClicked = false;
                  if (autoClickTimer) {
                    window.clearTimeout(autoClickTimer);
                    autoClickTimer = null;
                  }
                }
              }

              document.addEventListener('click', resetAutoClickWhenGeneratingAgain, true);
              hideMaybeLaterOptions();
              standardiseUnlockButtons();
              scheduleAutoOpenLeadModal();

              var observer = new MutationObserver(function () {
                hideMaybeLaterOptions();
                standardiseUnlockButtons();
                scheduleAutoOpenLeadModal();
              });

              observer.observe(document.body, {
                childList: true,
                subtree: true,
                characterData: true
              });
            })();
          `}
        </Script>
        <noscript>
          <img
            height="1"
            width="1"
            style={{ display: 'none' }}
            src="https://www.facebook.com/tr?id=947297821608514&ev=PageView&noscript=1"
            alt=""
          />
        </noscript>
        {children}
      </body>
    </html>
  );
}
