/**
 * Company research (task `research`, A03) for the thirteen fictional e2e
 * employers the writer applies to. Each answer is what the research model
 * returns after its web searches: a short write-up, then the JSON block, with
 * every claim citing a page it read. The "web" here is each employer's own
 * fictional example.com site, kept consistent with the employer's postings in
 * fixtures/feeds/e2e and the ATS replicas.
 */
import { contentText, type Answer, type DumpedRequest } from './index.ts';

interface Claim {
  text: string;
  sourceUrl: string;
}
interface Brief {
  whatTheyBuild: string;
  products: Claim[];
  recent: (Claim & { date: string | null })[];
  techSignals: Claim[];
  values: Claim[];
  stage: string;
  teamSize: string;
  hiringContact: { name: string; role: string; sourceUrl: string } | null;
}
interface Research {
  notes: string;
  pages: { url: string; title: string }[];
  brief: Brief;
}

const RESEARCH: Record<string, Research> = {
  'Lumen Ledger': {
    notes:
      "Lumen Ledger sells reconciliation and month-end close software to small finance teams, mostly accountants at companies of 20 to 200 people. Its site and engineering blog are recent and specific: the matching engine pairs bank lines with invoices, and the team has written about moving candidate matching into PostgreSQL. The careers page describes a remote team across EMEA and South Asia. I found no funding announcement in the window, so stage is left unknown.",
    pages: [
      { url: 'https://lumenledger.example.com/', title: 'Lumen Ledger: reconciliation and month-end close for small finance teams' },
      { url: 'https://lumenledger.example.com/product/matching', title: 'Bank matching | Lumen Ledger' },
      { url: 'https://lumenledger.example.com/blog/matching-rules-that-learn', title: 'Matching rules that learn from your team | Lumen Ledger' },
      { url: 'https://lumenledger.example.com/engineering/matching-in-postgres', title: 'Moving candidate matching into Postgres | Lumen Ledger Engineering' },
      { url: 'https://lumenledger.example.com/careers', title: 'Careers at Lumen Ledger' },
    ],
    brief: {
      whatTheyBuild: 'Reconciliation and month-end close software for small finance teams: bank feeds are imported and bank lines are matched to invoices automatically.',
      products: [
        { text: 'Bank matching: imports bank feeds and matches each bank line to open invoices, leaving only the exceptions for an accountant.', sourceUrl: 'https://lumenledger.example.com/product/matching' },
        { text: 'Close checklist: a shared month-end close list with sign-offs per account.', sourceUrl: 'https://lumenledger.example.com/' },
      ],
      recent: [
        {
          text: 'Launched matching rules that learn from the manual matches accountants make, so repeat exceptions get matched automatically the next month.',
          sourceUrl: 'https://lumenledger.example.com/blog/matching-rules-that-learn',
          date: '2026-09',
        },
      ],
      techSignals: [
        { text: 'Engineering post on moving candidate matching out of application code and into PostgreSQL queries.', sourceUrl: 'https://lumenledger.example.com/engineering/matching-in-postgres' },
        { text: 'Backend services are Node.js and TypeScript on PostgreSQL.', sourceUrl: 'https://lumenledger.example.com/careers' },
      ],
      values: [
        { text: 'Customers are accountants who are tired of matching bank lines in spreadsheets.', sourceUrl: 'https://lumenledger.example.com/' },
        { text: 'Small, well-tested changes shipped several times a week, reviewed by a senior engineer.', sourceUrl: 'https://lumenledger.example.com/careers' },
      ],
      stage: 'unknown',
      teamSize: 'about 34 people (careers page)',
      hiringContact: null,
    },
  },
  'Meridian Freight': {
    notes:
      'Meridian Freight is a digital freight forwarder: shippers in South Asia and the Gulf get quotes, bookings and tracking for ocean and air freight in one platform. The company site gives its own volume figures and describes a graduate programme for engineers. Recent news is a launch of instant air-freight quotes. Stage and headcount are not stated anywhere I could read.',
    pages: [
      { url: 'https://meridianfreight.example.com/', title: 'Meridian Freight: book and track ocean and air freight' },
      { url: 'https://meridianfreight.example.com/platform', title: 'The Meridian platform' },
      { url: 'https://meridianfreight.example.com/news/instant-air-quotes', title: 'Instant air-freight quotes are live | Meridian Freight' },
      { url: 'https://meridianfreight.example.com/careers/graduates', title: 'Graduate engineers | Meridian Freight careers' },
    ],
    brief: {
      whatTheyBuild: 'A digital freight-forwarding platform that quotes, books and tracks ocean and air shipments for shippers in South Asia and the Gulf.',
      products: [
        { text: 'Online quoting and booking for ocean and air freight with carrier options side by side.', sourceUrl: 'https://meridianfreight.example.com/platform' },
        { text: 'Shipment tracking with milestone alerts and a shared document folder per shipment.', sourceUrl: 'https://meridianfreight.example.com/platform' },
      ],
      recent: [{ text: 'Launched instant air-freight quotes for routes from Karachi, Lahore and Dubai.', sourceUrl: 'https://meridianfreight.example.com/news/instant-air-quotes', date: '2026-08' }],
      techSignals: [{ text: 'The platform team works in TypeScript and Node.js with PostgreSQL.', sourceUrl: 'https://meridianfreight.example.com/careers/graduates' }],
      values: [{ text: 'Graduate engineers ship to production in their first month, paired with a senior engineer.', sourceUrl: 'https://meridianfreight.example.com/careers/graduates' }],
      stage: 'unknown',
      teamSize: 'unknown',
      hiringContact: null,
    },
  },
  'Atlas Mutual': {
    notes:
      "Atlas Mutual is a member-owned insurer. Its Digital Engineering group builds the quoting, claims and self-service platforms, and this year it opened a remote engineering hub for engineers in Pakistan. The most relevant recent launch is online claim tracking for members. It is a long-established mutual, so 'stage' in the startup sense does not apply.",
    pages: [
      { url: 'https://atlasmutual.example.com/', title: 'Atlas Mutual: insurance owned by our members' },
      { url: 'https://atlasmutual.example.com/about', title: 'About Atlas Mutual' },
      { url: 'https://atlasmutual.example.com/newsroom/claims-tracking', title: 'Members can now track claims online | Atlas Mutual newsroom' },
      { url: 'https://atlasmutual.example.com/careers/digital-engineering', title: 'Digital Engineering careers | Atlas Mutual' },
    ],
    brief: {
      whatTheyBuild: 'Insurance for its members, with an in-house Digital Engineering group that builds quoting, claims and member self-service platforms.',
      products: [
        { text: 'Online claims: members file a claim and follow its progress from the website and app.', sourceUrl: 'https://atlasmutual.example.com/newsroom/claims-tracking' },
        { text: 'Online quotes and policy self-service for members.', sourceUrl: 'https://atlasmutual.example.com/' },
      ],
      recent: [
        { text: 'Launched online claim tracking so members can see each step of a claim without calling.', sourceUrl: 'https://atlasmutual.example.com/newsroom/claims-tracking', date: '2026-07' },
        { text: 'Opened a remote engineering hub for engineers based in Pakistan.', sourceUrl: 'https://atlasmutual.example.com/careers/digital-engineering', date: '2026-06' },
      ],
      techSignals: [{ text: 'Digital Engineering builds the API layer in TypeScript and Node.js with a React front end and PostgreSQL.', sourceUrl: 'https://atlasmutual.example.com/careers/digital-engineering' }],
      values: [{ text: 'Member-owned: the company answers to its policyholders rather than shareholders.', sourceUrl: 'https://atlasmutual.example.com/about' }],
      stage: 'established mutual insurer (member-owned)',
      teamSize: 'unknown',
      hiringContact: null,
    },
  },
  'Kranich Software GmbH': {
    notes:
      'Kranich builds warehouse-management software for mid-sized retailers in Germany and Austria, from its Hamburg base, with a fully remote engineering team since 2020. Its engineering blog has a recent post on partitioning the stock-movements table, and a product update added a DATEV export. The careers page names the employer-of-record arrangement for South Asia.',
    pages: [
      { url: 'https://kranich.example.com/', title: 'Kranich: warehouse software for retailers' },
      { url: 'https://kranich.example.com/en/product', title: 'Kranich WMS | Product' },
      { url: 'https://kranich.example.com/en/blog/partitioning-stock-movements', title: 'Partitioning our stock-movements table | Kranich Engineering' },
      { url: 'https://kranich.example.com/en/news/datev-export', title: 'New: DATEV export | Kranich' },
      { url: 'https://kranich.example.com/en/careers', title: 'Careers | Kranich Software GmbH' },
    ],
    brief: {
      whatTheyBuild: 'Warehouse-management software for mid-sized retailers in Germany and Austria: stock movements, picking and shipping, with ERP and accounting integrations.',
      products: [
        { text: 'Kranich WMS: stock movements, picking lists and shipping for retail warehouses.', sourceUrl: 'https://kranich.example.com/en/product' },
        { text: 'A handheld picking app for warehouse staff.', sourceUrl: 'https://kranich.example.com/en/product' },
      ],
      recent: [
        { text: 'Released a DATEV export so stock valuations flow straight into customers’ accounting.', sourceUrl: 'https://kranich.example.com/en/news/datev-export', date: '2026-06' },
        { text: 'Engineering blog post on partitioning the stock-movements table in PostgreSQL by month.', sourceUrl: 'https://kranich.example.com/en/blog/partitioning-stock-movements', date: '2026-09' },
      ],
      techSignals: [
        { text: 'Node.js and TypeScript services on PostgreSQL, with RabbitMQ between services.', sourceUrl: 'https://kranich.example.com/en/careers' },
        { text: 'Monthly partitions on the stock-movements table to keep queries fast at hundreds of millions of rows.', sourceUrl: 'https://kranich.example.com/en/blog/partitioning-stock-movements' },
      ],
      values: [{ text: 'English is the engineering team’s working language; a fortnightly architecture round is open to everyone.', sourceUrl: 'https://kranich.example.com/en/careers' }],
      stage: 'privately held, profitable (company site)',
      teamSize: 'about 60 people',
      hiringContact: null,
    },
  },
  'Northwind Labs': {
    notes:
      "Northwind Labs sells a scheduling and dispatch API that home-services businesses build into their own apps. The engineering blog is active: a recent post covers running migrations on the bookings table without downtime, and a product update shipped signed webhooks. The company describes itself as a remote team of 22.",
    pages: [
      { url: 'https://northwindlabs.example.com/', title: 'Northwind Labs: scheduling and dispatch API' },
      { url: 'https://northwindlabs.example.com/docs/webhooks', title: 'Webhooks v2 | Northwind Labs docs' },
      { url: 'https://northwindlabs.example.com/blog/zero-downtime-migrations', title: 'Migrating a busy bookings table without downtime | Northwind Labs' },
      { url: 'https://northwindlabs.example.com/about', title: 'About Northwind Labs' },
    ],
    brief: {
      whatTheyBuild: 'A scheduling and dispatch API that home-services businesses (plumbers, electricians, cleaners) plug into their own apps.',
      products: [
        { text: 'Bookings API for scheduling jobs and technicians.', sourceUrl: 'https://northwindlabs.example.com/' },
        { text: 'Webhooks v2 with signed payloads and automatic retries.', sourceUrl: 'https://northwindlabs.example.com/docs/webhooks' },
      ],
      recent: [
        { text: 'Shipped webhooks v2 with signed payloads and retries.', sourceUrl: 'https://northwindlabs.example.com/docs/webhooks', date: '2026-08' },
        { text: 'Blog post on migrating the bookings table without downtime using expand-and-contract steps.', sourceUrl: 'https://northwindlabs.example.com/blog/zero-downtime-migrations', date: '2026-10' },
      ],
      techSignals: [
        { text: 'NestJS on Node.js and TypeScript, PostgreSQL, BullMQ for background jobs.', sourceUrl: 'https://northwindlabs.example.com/blog/zero-downtime-migrations' },
      ],
      values: [{ text: 'Remote-first; engineers take a turn answering customer developers’ questions.', sourceUrl: 'https://northwindlabs.example.com/about' }],
      stage: 'unknown',
      teamSize: '22 people',
      hiringContact: null,
    },
  },
  'Orchard Robotics': {
    notes:
      "Orchard Robotics builds small autonomous platforms that scout fruit orchards for disease and frost damage, and a web dashboard where growers see the findings. The most recent update is a frost-alert timeline in the dashboard. The careers page describes a small engineering team with two senior engineers.",
    pages: [
      { url: 'https://orchardrobotics.example.com/', title: 'Orchard Robotics: scouting robots for fruit growers' },
      { url: 'https://orchardrobotics.example.com/dashboard', title: 'The grower dashboard | Orchard Robotics' },
      { url: 'https://orchardrobotics.example.com/news/frost-alerts', title: 'Frost alerts, block by block | Orchard Robotics' },
      { url: 'https://orchardrobotics.example.com/careers', title: 'Careers | Orchard Robotics' },
    ],
    brief: {
      whatTheyBuild: 'Small autonomous robots that scout orchards for disease and frost damage, plus the web dashboard where growers review what the robots found.',
      products: [
        { text: 'Scouting robots that drive orchard rows and photograph trees for signs of disease and frost damage.', sourceUrl: 'https://orchardrobotics.example.com/' },
        { text: 'Grower dashboard with map views of orchard blocks, alert timelines and report exports.', sourceUrl: 'https://orchardrobotics.example.com/dashboard' },
      ],
      recent: [{ text: 'Added a frost-alert timeline that shows damage block by block on the orchard map.', sourceUrl: 'https://orchardrobotics.example.com/news/frost-alerts', date: '2026-09' }],
      techSignals: [{ text: 'Dashboard in React and TypeScript; telemetry served by a Node.js (Fastify) API on PostgreSQL.', sourceUrl: 'https://orchardrobotics.example.com/careers' }],
      values: [{ text: 'Engineers help the field team when a robot’s data upload fails.', sourceUrl: 'https://orchardrobotics.example.com/careers' }],
      stage: 'unknown',
      teamSize: 'unknown',
      hiringContact: null,
    },
  },
  Quillstack: {
    notes:
      'Quillstack is a docs-as-code platform for technical documentation teams, with live previews and review workflows modelled on pull requests. Its changelog shows a suggested-edits feature for the editor this summer and MDX 3 support in the renderer. The site says about 2,000 companies publish developer docs with it.',
    pages: [
      { url: 'https://quillstack.example.com/', title: 'Quillstack: docs as code, with reviews that feel like pull requests' },
      { url: 'https://quillstack.example.com/changelog/suggested-edits', title: 'Suggested edits in the editor | Quillstack changelog' },
      { url: 'https://quillstack.example.com/changelog/mdx-3', title: 'MDX 3 rendering | Quillstack changelog' },
      { url: 'https://quillstack.example.com/about', title: 'About Quillstack' },
    ],
    brief: {
      whatTheyBuild: 'A writing platform for technical documentation teams: docs-as-code, live previews and review workflows that work like pull requests.',
      products: [
        { text: 'A collaborative React editor with live previews of the published page.', sourceUrl: 'https://quillstack.example.com/' },
        { text: 'Review workflows where doc changes are proposed, commented on and merged like pull requests.', sourceUrl: 'https://quillstack.example.com/' },
      ],
      recent: [
        { text: 'Launched suggested edits: reviewers propose wording changes inline and the author accepts them one by one.', sourceUrl: 'https://quillstack.example.com/changelog/suggested-edits', date: '2026-07' },
        { text: 'Rendering service upgraded to MDX 3.', sourceUrl: 'https://quillstack.example.com/changelog/mdx-3', date: '2026-10' },
      ],
      techSignals: [{ text: 'TypeScript throughout: a React editor and Node.js services that render Markdown and MDX.', sourceUrl: 'https://quillstack.example.com/changelog/mdx-3' }],
      values: [{ text: 'Documentation is part of the product, and it deserves the same review as code.', sourceUrl: 'https://quillstack.example.com/about' }],
      stage: 'unknown',
      teamSize: 'unknown',
      hiringContact: null,
    },
  },
  'Copperline Payments': {
    notes:
      'Copperline provides a payout and reconciliation API for online marketplaces that pay sellers in many countries. The engineering blog has a clear post on idempotency keys for payouts, and the product site added a returned-payouts dashboard for operations teams. The careers page talks about blameless incident reviews.',
    pages: [
      { url: 'https://copperline.example.com/', title: 'Copperline: payouts and reconciliation for marketplaces' },
      { url: 'https://copperline.example.com/product/returns', title: 'Returned payouts, handled | Copperline' },
      { url: 'https://copperline.example.com/engineering/idempotency-keys', title: 'Idempotency keys for payouts | Copperline Engineering' },
      { url: 'https://copperline.example.com/careers', title: 'Careers | Copperline Payments' },
    ],
    brief: {
      whatTheyBuild: 'A payout and reconciliation API that online marketplaces use to pay their sellers across many countries.',
      products: [
        { text: 'Payouts API that schedules, batches and tracks payments to marketplace sellers.', sourceUrl: 'https://copperline.example.com/' },
        { text: 'Reconciliation reports that tie every payout back to the marketplace’s ledger.', sourceUrl: 'https://copperline.example.com/' },
      ],
      recent: [
        { text: 'Launched a returned-payouts dashboard so operations teams can see and re-send payouts a bank sends back.', sourceUrl: 'https://copperline.example.com/product/returns', date: '2026-08' },
        { text: 'Engineering post on idempotency keys: every payout request carries a key so a retry can never pay a seller twice.', sourceUrl: 'https://copperline.example.com/engineering/idempotency-keys', date: '2026-10' },
      ],
      techSignals: [{ text: 'Node.js and TypeScript services on PostgreSQL; internal tools in React.', sourceUrl: 'https://copperline.example.com/careers' }],
      values: [{ text: 'Blameless incident reviews after anything goes wrong with money movement.', sourceUrl: 'https://copperline.example.com/careers' }],
      stage: 'unknown',
      teamSize: 'about 30 engineers',
      hiringContact: null,
    },
  },
  'Harbor & Pine': {
    notes:
      "Harbor & Pine runs the booking and payments platform used by independent outdoor-gear rental shops across North America. Its Platform team owns authentication, billing, event streaming and an internal developer portal; the engineering blog describes the event-streaming platform on Kafka and services on Kubernetes. The developer portal was opened to all product teams this year.",
    pages: [
      { url: 'https://harborpine.example.com/', title: 'Harbor & Pine: booking and payments for rental shops' },
      { url: 'https://harborpine.example.com/engineering/platform-team', title: 'What the Platform team does | Harbor & Pine Engineering' },
      { url: 'https://harborpine.example.com/engineering/developer-portal', title: 'Our internal developer portal | Harbor & Pine Engineering' },
    ],
    brief: {
      whatTheyBuild: 'The booking and payments platform behind independent outdoor-gear rental shops in North America.',
      products: [
        { text: 'Online booking and payments for gear rental shops.', sourceUrl: 'https://harborpine.example.com/' },
        { text: 'Shared platform services: authentication, billing, event streaming and an internal developer portal.', sourceUrl: 'https://harborpine.example.com/engineering/platform-team' },
      ],
      recent: [{ text: 'Opened the internal developer portal to every product team.', sourceUrl: 'https://harborpine.example.com/engineering/developer-portal', date: '2026-08' }],
      techSignals: [{ text: 'Go and TypeScript services on Kubernetes; Kafka for event streaming.', sourceUrl: 'https://harborpine.example.com/engineering/platform-team' }],
      values: [{ text: 'Teams own the reliability of the services they build, including on-call.', sourceUrl: 'https://harborpine.example.com/engineering/platform-team' }],
      stage: 'unknown',
      teamSize: 'unknown',
      hiringContact: null,
    },
  },
  'Pebble Analytics': {
    notes:
      'The job ad itself is a one-liner, so the company site carries the context: Pebble Analytics builds reporting dashboards for independent gyms and fitness studios. The team describes its stack plainly (Python/Django backend, TypeScript front end, a PostgreSQL warehouse fed by nightly pipelines), and recently launched class-attendance forecasts.',
    pages: [
      { url: 'https://pebbleanalytics.example.com/', title: 'Pebble Analytics: reporting for gyms and studios' },
      { url: 'https://pebbleanalytics.example.com/blog/attendance-forecasts', title: 'Class attendance forecasts | Pebble Analytics' },
      { url: 'https://pebbleanalytics.example.com/team', title: 'The Pebble team' },
    ],
    brief: {
      whatTheyBuild: 'Reporting dashboards for independent gyms and fitness studios.',
      products: [{ text: 'Dashboards for memberships, class attendance and revenue for gyms and studios.', sourceUrl: 'https://pebbleanalytics.example.com/' }],
      recent: [{ text: 'Launched class-attendance forecasts so studios can plan instructors a week ahead.', sourceUrl: 'https://pebbleanalytics.example.com/blog/attendance-forecasts', date: '2026-09' }],
      techSignals: [
        { text: 'Python/Django backend, a TypeScript front end and a PostgreSQL warehouse fed by nightly pipelines.', sourceUrl: 'https://pebbleanalytics.example.com/team' },
      ],
      values: [{ text: 'A small team that publishes the salary range for every role it opens.', sourceUrl: 'https://pebbleanalytics.example.com/team' }],
      stage: 'unknown',
      teamSize: 'seven engineers',
      hiringContact: null,
    },
  },
  'Saffron Studio': {
    notes:
      'Saffron Studio is a Stockholm product studio that builds ordering, loyalty and kitchen-display apps for restaurant groups in the Nordics, and runs everything in-house. A recent case study covers a kitchen-display system that keeps working when the restaurant’s internet drops. Early-career developers get a buddy and a growth plan, per the careers page.',
    pages: [
      { url: 'https://saffronstudio.example.com/', title: 'Saffron Studio: apps for restaurant groups' },
      { url: 'https://saffronstudio.example.com/work/offline-kitchen-display', title: 'A kitchen display that keeps going offline | Saffron Studio' },
      { url: 'https://saffronstudio.example.com/careers', title: 'Careers | Saffron Studio' },
    ],
    brief: {
      whatTheyBuild: 'Ordering, loyalty and kitchen-display apps for restaurant groups across the Nordics, designed and built in-house.',
      products: [
        { text: 'Online ordering and loyalty apps for restaurant groups.', sourceUrl: 'https://saffronstudio.example.com/' },
        { text: 'Kitchen-display system for restaurant kitchens.', sourceUrl: 'https://saffronstudio.example.com/work/offline-kitchen-display' },
      ],
      recent: [
        { text: 'Case study: a kitchen-display system that keeps taking orders when the restaurant’s internet drops and syncs when it returns.', sourceUrl: 'https://saffronstudio.example.com/work/offline-kitchen-display', date: '2026-06' },
      ],
      techSignals: [{ text: 'Next.js and React front ends, Node.js (TypeScript) APIs, PostgreSQL.', sourceUrl: 'https://saffronstudio.example.com/careers' }],
      values: [{ text: 'Early-career developers work on real client projects from week one, with a buddy and a growth plan.', sourceUrl: 'https://saffronstudio.example.com/careers' }],
      stage: 'bootstrapped studio (company site)',
      teamSize: '25 people',
      hiringContact: null,
    },
  },
  'Tulip & Tern': {
    notes:
      'Tulip & Tern is a small Amsterdam studio that designs and builds websites and booking tools for independent hotels and B&Bs. It recently published its accessibility checklist for client sites. Fourteen people, per the about page.',
    pages: [
      { url: 'https://tulipandtern.example.com/', title: 'Tulip & Tern: websites and booking tools for independent hotels' },
      { url: 'https://tulipandtern.example.com/journal/accessibility-checklist', title: 'Our accessibility checklist, published | Tulip & Tern' },
      { url: 'https://tulipandtern.example.com/about', title: 'About Tulip & Tern' },
    ],
    brief: {
      whatTheyBuild: 'Websites and booking tools for independent hotels and B&Bs.',
      products: [
        { text: 'Fast, accessible websites for independent hotels and B&Bs.', sourceUrl: 'https://tulipandtern.example.com/' },
        { text: 'Small React apps that let hotel owners manage rooms and bookings, backed by a Node.js booking API.', sourceUrl: 'https://tulipandtern.example.com/' },
      ],
      recent: [
        { text: 'Published the accessibility checklist the studio runs on every client site before launch.', sourceUrl: 'https://tulipandtern.example.com/journal/accessibility-checklist', date: '2026-09' },
      ],
      techSignals: [{ text: 'React and TypeScript components, a Node.js booking API, and headless CMSs such as Sanity.', sourceUrl: 'https://tulipandtern.example.com/' }],
      values: [{ text: 'Accessibility and speed are checked on every client site, not left to the end.', sourceUrl: 'https://tulipandtern.example.com/journal/accessibility-checklist' }],
      stage: 'independent studio',
      teamSize: '14 people',
      hiringContact: null,
    },
  },
  'Brightwater Health': {
    notes:
      'Brightwater Health makes appointment and prescription-reminder software for community pharmacies in the UK and Ireland. A summer update added two-way SMS so patients can reply to confirm a repeat prescription, and the security page describes how patient data is handled. The engineering team is nine people.',
    pages: [
      { url: 'https://brightwaterhealth.example.com/', title: 'Brightwater Health: reminders for community pharmacies' },
      { url: 'https://brightwaterhealth.example.com/updates/two-way-sms', title: 'Patients can now reply to reminders | Brightwater Health' },
      { url: 'https://brightwaterhealth.example.com/security', title: 'Security and patient data | Brightwater Health' },
    ],
    brief: {
      whatTheyBuild: 'Appointment and prescription-reminder software for community pharmacies in the UK and Ireland.',
      products: [
        { text: 'Pharmacist dashboard for appointments and repeat prescriptions.', sourceUrl: 'https://brightwaterhealth.example.com/' },
        { text: 'SMS and email reminders to patients, with delivery tracking.', sourceUrl: 'https://brightwaterhealth.example.com/' },
      ],
      recent: [{ text: 'Added two-way SMS: patients reply to a reminder to confirm or delay a repeat prescription.', sourceUrl: 'https://brightwaterhealth.example.com/updates/two-way-sms', date: '2026-07' }],
      techSignals: [{ text: 'Node.js (TypeScript) services with PostgreSQL and Redis-backed job queues.', sourceUrl: 'https://brightwaterhealth.example.com/security' }],
      values: [{ text: 'Patient data is kept to the minimum needed and access is logged.', sourceUrl: 'https://brightwaterhealth.example.com/security' }],
      stage: 'unknown',
      teamSize: 'nine engineers',
      hiringContact: null,
    },
  },
};

export function researchAnswer(req: DumpedRequest): Answer {
  const text = contentText(req);
  const company = text.match(/^Company: (.+)$/m)?.[1]?.trim();
  if (!company) return { skip: 'research: no company line' };
  if (!req.system.join('\n').startsWith('You research one company')) return { skip: `research: unexpected system prompt for ${company}` };
  const r = RESEARCH[company];
  if (!r) return { skip: `research: nothing authored for ${company}` };
  const answer = `${r.notes}\n\n\`\`\`json\n${JSON.stringify(r.brief, null, 2)}\n\`\`\`\n`;
  return { label: `research: ${company}`, body: { text: answer, sources: r.pages } };
}

/** For the writer's authored answers: the hook URLs a brief makes available. */
export function researchUrls(company: string): string[] {
  return RESEARCH[company]?.pages.map((p) => p.url) ?? [];
}
