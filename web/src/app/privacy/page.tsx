'use client'

import Link from 'next/link'
import { useTranslation } from '@/hooks/useTranslation'
import type { Locale } from '@/lib/i18n'

// Politique de confidentialité (exigée par Google Play). Elle décrit ce que le
// code envoie réellement, vérifié dans web/src :
//  - lib/geocoding.ts : Photon (texte tapé + centre d'Alger comme biais fixe)
//    et Nominatim (point touché longuement sur la carte) ;
//  - components/MapView.tsx : tuiles OpenFreeMap ;
//  - app/api/otp : calcul d'itinéraire sur notre serveur, sans journal ; l'IP du
//    client n'est gardée qu'en mémoire (limiteur de débit, route.ts) ;
//  - localStorage : langue, lieux enregistrés, recherches récentes, session de
//    navigation (itinéraire + état + positions des 30 dernières secondes,
//    hooks/useNavigationSession.ts, lib/navigation.ts « track ») ;
//  - report.ts / map-report.ts : courriel de signalement (mailto), contenu = ligne,
//    arrêt, coordonnées, trajet, langue, version, heure ;
//  - aucun analytics, aucun cookie, aucune publicité, aucun compte.
// Si l'un de ces faits change, cette page doit changer avec lui.

const CONTACT = 'contact@lounis.dev'
const UPDATED = '2026-11-07'

interface Section {
  title: string
  body: string[]
}

interface Doc {
  title: string
  updated: string
  back: string
  sections: Section[]
}

const DOCS: Record<Locale, Doc> = {
  fr: {
    title: 'Politique de confidentialité',
    updated: 'Dernière mise à jour :',
    back: 'Retour à l’application',
    sections: [
      {
        title: 'En résumé',
        body: [
          'Nouri n’a pas de compte, pas de publicité, pas de statistiques d’usage et pas de cookies. Nous ne vendons aucune donnée. Seules les requêtes techniques décrites plus bas partent vers des services tiers (recherche d’adresses et fond de carte). Ce que vous enregistrez dans l’application reste sur votre téléphone.',
        ],
      },
      {
        title: 'Votre position',
        body: [
          'Si vous l’autorisez, la position de votre téléphone sert à afficher votre point sur la carte, à proposer les arrêts proches, à partir de « ma position » et à suivre votre trajet. Elle est utilisée sur l’appareil. Vous pouvez la refuser ou la retirer dans les réglages d’Android : l’application fonctionne alors en saisissant les adresses à la main.',
          'Si vous choisissez « ma position » comme départ, ses coordonnées sont envoyées, comme toute autre adresse de départ, à notre serveur pour calculer l’itinéraire (voir plus bas).',
        ],
      },
      {
        title: 'Ce qui est envoyé à des services tiers',
        body: [
          'Recherche d’adresse : le texte que vous tapez est envoyé à Photon (photon.komoot.io, service de Komoot basé sur OpenStreetMap), avec le centre d’Alger comme point de référence fixe. Votre position n’est pas envoyée.',
          'Appui long sur la carte : les coordonnées du point touché sont envoyées à Nominatim (nominatim.openstreetmap.org, Fondation OpenStreetMap) pour obtenir le nom de la rue.',
          'Fond de carte : votre appareil télécharge des tuiles depuis OpenFreeMap (tiles.openfreemap.org). Comme pour tout site web, ce service reçoit votre adresse IP et les zones de carte que vous consultez.',
          'Ces services appliquent leurs propres politiques de confidentialité.',
        ],
      },
      {
        title: 'Calcul d’itinéraire',
        body: [
          'Les coordonnées du départ et de l’arrivée, ainsi que l’heure demandée, sont envoyées à notre serveur (nouri.lounis.dev) pour calculer l’itinéraire. Elles ne servent qu’à ce calcul. Nous ne conservons pas les trajets demandés et nous ne les associons à aucune identité. Pour limiter les abus, notre serveur garde votre adresse IP en mémoire vive seulement (jamais dans un journal ni sur un disque) ; elle disparaît au redémarrage du serveur.',
        ],
      },
      {
        title: 'Données enregistrées sur votre téléphone',
        body: [
          'L’application mémorise localement votre langue, vos lieux enregistrés, vos recherches récentes et la session de navigation en cours (détaillée plus bas). Ces données ne quittent pas l’appareil. Vous pouvez les effacer en vidant les données de l’application dans les réglages d’Android, ou en la désinstallant.',
          'Session de navigation : pendant un trajet suivi, l’application enregistre sur l’appareil, et seulement là, l’itinéraire, l’avancement et vos dernières positions (30 secondes au plus), pour reprendre où vous en étiez si la page se recharge. La reprise est possible pendant 30 minutes au plus ; passé ce délai, ou une fois la navigation quittée ou terminée, la session est effacée (au plus tard à la prochaine ouverture de l’application). Elle n’est jamais envoyée. Seul un nouveau calcul de trajet que vous demandez en cours de route envoie votre position actuelle comme départ, comme tout calcul d’itinéraire (voir plus haut).',
          'Pour fonctionner sans réseau, l’application garde aussi en cache ses pages, ses données de lignes et des tuiles de carte.',
        ],
      },
      {
        title: 'Données de transport',
        body: [
          'Les lignes et les arrêts viennent de sources ouvertes (notamment OpenStreetMap) et d’horaires publiés. Il n’y a pas de données en temps réel à Alger : les durées et horaires affichés sont des estimations, signalées par « ~ ».',
        ],
      },
      {
        title: 'Enfants',
        body: [
          'Nouri ne collecte aucune donnée personnelle et ne s’adresse pas spécifiquement aux enfants.',
        ],
      },
      {
        title: 'Contact',
        body: [
          `Pour toute question ou pour signaler une erreur : ${CONTACT}. Le bouton « Signaler une erreur » ouvre un courriel pré-rempli dans votre application de messagerie. Selon l’écran, il peut contenir la ligne ou l’arrêt concerné, des coordonnées (arrêt, départ et arrivée, y compris votre position si elle servait de départ) et le trajet affiché, ainsi que la langue, la version de l’application et l’heure. Il n’est envoyé que si vous le validez, depuis votre propre messagerie : relisez-le avant l’envoi.`,
          'Si cette politique change, la date ci-dessus est mise à jour.',
        ],
      },
    ],
  },
  ar: {
    title: 'سياسة الخصوصية',
    updated: 'آخر تحديث:',
    back: 'العودة إلى التطبيق',
    sections: [
      {
        title: 'باختصار',
        body: [
          'ليس في «نوري» حسابات ولا إعلانات ولا إحصاءات استخدام ولا ملفات تعريف ارتباط. لا نبيع أي بيانات. لا تُرسل إلى جهات خارجية إلا الطلبات التقنية الموضحة أدناه (البحث عن العناوين وخلفية الخريطة). ما تحفظه في التطبيق يبقى على هاتفك.',
        ],
      },
      {
        title: 'موقعك',
        body: [
          'إذا سمحت بذلك، يُستخدم موقع هاتفك لعرض نقطتك على الخريطة واقتراح المحطات القريبة والانطلاق من «موقعي» ومتابعة رحلتك. يُستخدم الموقع على الجهاز نفسه. يمكنك رفضه أو سحبه من إعدادات أندرويد، وعندها يعمل التطبيق بإدخال العناوين يدويًا.',
          'إذا اخترت «موقعي» نقطةَ انطلاق، تُرسل إحداثياته إلى خادمنا، مثل أي عنوان انطلاق آخر، لحساب المسار (انظر أدناه).',
        ],
      },
      {
        title: 'ما يُرسل إلى جهات خارجية',
        body: [
          'البحث عن عنوان: يُرسل النص الذي تكتبه إلى Photon (‏photon.komoot.io، خدمة من Komoot مبنية على OpenStreetMap)، مع مركز الجزائر العاصمة كنقطة مرجعية ثابتة. لا يُرسل موقعك.',
          'الضغط المطوّل على الخريطة: تُرسل إحداثيات النقطة المضغوطة إلى Nominatim (‏nominatim.openstreetmap.org، مؤسسة OpenStreetMap) للحصول على اسم الشارع.',
          'خلفية الخريطة: ينزّل جهازك بلاطات الخريطة من OpenFreeMap (‏tiles.openfreemap.org). كما في أي موقع ويب، تتلقى هذه الخدمة عنوان IP الخاص بك ومناطق الخريطة التي تتصفحها.',
          'تخضع هذه الخدمات لسياسات الخصوصية الخاصة بها.',
        ],
      },
      {
        title: 'حساب المسار',
        body: [
          'تُرسل إحداثيات الانطلاق والوصول والوقت المطلوب إلى خادمنا (nouri.lounis.dev) لحساب المسار. لا تُستخدم إلا لهذا الحساب. لا نحتفظ بالرحلات المطلوبة ولا نربطها بأي هوية. وللحدّ من الإساءة، يحتفظ خادمنا بعنوان IP الخاص بك في الذاكرة الحية فقط (لا في سجلّ ولا على قرص)، ويزول عند إعادة تشغيل الخادم.',
        ],
      },
      {
        title: 'البيانات المحفوظة على هاتفك',
        body: [
          'يحفظ التطبيق محليًا لغتك وأماكنك المحفوظة وعمليات البحث الأخيرة وجلسة الملاحة الجارية (مشروحة أدناه). لا تغادر هذه البيانات الجهاز. يمكنك مسحها بحذف بيانات التطبيق من إعدادات أندرويد أو بإلغاء تثبيته.',
          'جلسة الملاحة: أثناء رحلة تتابعها، يسجّل التطبيق على الجهاز وحده مسار الرحلة وتقدّمها وآخر مواضعك (30 ثانية على الأكثر)، ليستأنف من حيث وصلتَ إذا أُعيد تحميل الصفحة. يمكن الاستئناف خلال 30 دقيقة على الأكثر؛ وبعد ذلك، أو متى غادرتَ الملاحة أو انتهت، تُمسح الجلسة (في موعد أقصاه عند فتح التطبيق في المرة التالية). لا تُرسل هذه الجلسة أبدًا. وحده طلب حساب جديد للمسار أثناء الطريق يرسل موقعك الحالي كنقطة انطلاق، كأي حساب للمسار (انظر أعلاه).',
          'ليعمل التطبيق دون اتصال، يحتفظ أيضًا بصفحاته وبيانات الخطوط وبعض بلاطات الخريطة في ذاكرة مؤقتة.',
        ],
      },
      {
        title: 'بيانات النقل',
        body: [
          'الخطوط والمحطات مصدرها بيانات مفتوحة (منها OpenStreetMap) ومواعيد منشورة. لا توجد بيانات في الزمن الحقيقي في الجزائر العاصمة: المدد والمواعيد المعروضة تقديرية وتُشار إليها بـ «~».',
        ],
      },
      {
        title: 'الأطفال',
        body: [
          'لا يجمع «نوري» أي بيانات شخصية ولا يستهدف الأطفال تحديدًا.',
        ],
      },
      {
        title: 'التواصل',
        body: [
          `لأي سؤال أو للإبلاغ عن خطأ: ${CONTACT}. زر «الإبلاغ عن خطأ» يفتح رسالة بريد معبّأة مسبقًا في تطبيق البريد لديك. بحسب الشاشة، قد تتضمن الخط أو المحطة المعنيّة وإحداثيات (المحطة، أو الانطلاق والوصول، ومنها موقعك إن كان نقطة الانطلاق) والمسار المعروض، إضافةً إلى اللغة وإصدار التطبيق والوقت. لا تُرسل إلا إذا أكدتَ إرسالها من تطبيق البريد الخاص بك: راجعها قبل الإرسال.`,
          'إذا تغيّرت هذه السياسة يُحدَّث التاريخ أعلاه.',
        ],
      },
    ],
  },
  en: {
    title: 'Privacy policy',
    updated: 'Last updated:',
    back: 'Back to the app',
    sections: [
      {
        title: 'In short',
        body: [
          'Nouri has no accounts, no ads, no usage analytics and no cookies. We do not sell any data. Only the technical requests described below are sent to third-party services (address search and map background). What you save in the app stays on your phone.',
        ],
      },
      {
        title: 'Your location',
        body: [
          'If you allow it, your phone’s location is used to show your position on the map, suggest nearby stops, start from “my location” and follow your trip. It is used on the device. You can refuse it or withdraw it in Android settings: the app then works by typing addresses by hand.',
          'If you pick “my location” as your starting point, its coordinates are sent to our server, like any other starting address, to calculate the route (see below).',
        ],
      },
      {
        title: 'What is sent to third-party services',
        body: [
          'Address search: the text you type is sent to Photon (photon.komoot.io, a Komoot service built on OpenStreetMap), with the centre of Algiers as a fixed reference point. Your location is not sent.',
          'Long press on the map: the coordinates of the point you touch are sent to Nominatim (nominatim.openstreetmap.org, OpenStreetMap Foundation) to get the street name.',
          'Map background: your device downloads map tiles from OpenFreeMap (tiles.openfreemap.org). As with any website, this service receives your IP address and the map areas you view.',
          'These services apply their own privacy policies.',
        ],
      },
      {
        title: 'Route calculation',
        body: [
          'The start and end coordinates, and the requested time, are sent to our server (nouri.lounis.dev) to calculate the route. They are used only for that calculation. We do not keep the trips requested and do not link them to any identity. To limit abuse, our server keeps your IP address in memory only (never in a log or on disk); it disappears when the server restarts.',
        ],
      },
      {
        title: 'Data stored on your phone',
        body: [
          'The app stores locally your language, saved places, recent searches and the navigation session in progress (described below). This data never leaves the device. You can erase it by clearing the app’s data in Android settings, or by uninstalling it.',
          'Navigation session: during a trip you are following, the app stores on the device, and only there, the route, your progress and your latest positions (30 seconds at most), so it can pick up where you were if the page reloads. It can be resumed for 30 minutes at most; after that, or once the navigation is left or finished, the session is erased (at the latest the next time the app opens). It is never sent anywhere. Only a new route calculation that you request along the way sends your current position as the starting point, like any route calculation (see above).',
          'To work offline, the app also caches its pages, line data and some map tiles.',
        ],
      },
      {
        title: 'Transit data',
        body: [
          'Lines and stops come from open sources (notably OpenStreetMap) and published timetables. There is no real-time data in Algiers: the durations and times shown are estimates, marked with “~”.',
        ],
      },
      {
        title: 'Children',
        body: [
          'Nouri collects no personal data and is not specifically aimed at children.',
        ],
      },
      {
        title: 'Contact',
        body: [
          `For any question or to report an error: ${CONTACT}. The “Report an error” button opens a pre-filled email in your mail app. Depending on the screen, it may contain the line or stop concerned, coordinates (stop, start and end points, including your location if it was the starting point) and the route shown, plus the language, app version and time. It is sent only if you confirm it from your own mail app: read it before sending.`,
          'If this policy changes, the date above is updated.',
        ],
      },
    ],
  },
}

export default function PrivacyPage() {
  const { locale } = useTranslation()
  const doc = DOCS[locale]

  // html/body sont en overflow:hidden (globals.css) : cette page défile elle-même.
  return (
    <main className="h-[100dvh] overflow-y-auto bg-white px-5 pb-12 pt-6 text-ink-900">
      <article className="mx-auto max-w-2xl">
        <Link href="/" className="inline-flex min-h-[44px] items-center text-body font-semibold text-brand">
          {doc.back}
        </Link>
        <h1 className="mt-2 text-title font-semibold">{doc.title}</h1>
        <p className="mt-1 text-caption text-ink-400">
          {doc.updated} <span dir="ltr">{UPDATED}</span>
        </p>
        {doc.sections.map((section) => (
          <section key={section.title} className="mt-6">
            <h2 className="text-emph font-semibold">{section.title}</h2>
            {section.body.map((paragraph, i) => (
              <p key={i} className="mt-2 text-body leading-relaxed text-ink-600">
                {paragraph}
              </p>
            ))}
          </section>
        ))}
      </article>
    </main>
  )
}
