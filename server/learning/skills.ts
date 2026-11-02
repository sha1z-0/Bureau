/**
 * A small lexicon of learnable technical skills, so requirement sentences
 * ("3+ years running Kubernetes in production") collapse onto one skill name
 * and gaps can be counted across jobs without asking a model. Patterns are
 * matched case-insensitively on word boundaries.
 */

type Entry = [name: string, pattern: string | RegExp, doc?: string];

const ENTRIES: Entry[] = [
  // Languages
  ['Python', 'python', 'https://docs.python.org/3/tutorial/'],
  // Case-sensitive: "go" and "C" are ordinary words otherwise.
  ['Go', /golang|(?:^|[^A-Za-z])Go(?=[\s,/);.]|$)(?!\s+(?:ahead|live|forward|beyond|through|over|back)\b)/, 'https://go.dev/tour/'],
  ['Rust', 'rust', 'https://doc.rust-lang.org/book/'],
  ['Java', 'java(?!\\s*script)', 'https://dev.java/learn/'],
  ['Kotlin', 'kotlin', 'https://kotlinlang.org/docs/getting-started.html'],
  ['Swift', 'swift(?:ui)?', 'https://www.swift.org/getting-started/'],
  ['C#', 'c#|\\.net|dotnet|asp\\.net', 'https://learn.microsoft.com/dotnet/csharp/'],
  ['C++', 'c\\+\\+', 'https://www.learncpp.com/'],
  ['C', /(?:^|[^A-Za-z])C(?=[\s,/)]|$)(?![+#])/, 'https://en.cppreference.com/w/c'],
  ['TypeScript', 'typescript|\\bts\\b', 'https://www.typescriptlang.org/docs/handbook/intro.html'],
  ['JavaScript', 'javascript|\\bjs\\b|ecmascript', 'https://developer.mozilla.org/docs/Web/JavaScript/Guide'],
  ['Ruby', 'ruby(?! on rails)', 'https://www.ruby-lang.org/en/documentation/'],
  ['PHP', 'php', 'https://www.php.net/manual/en/getting-started.php'],
  ['Scala', 'scala', 'https://docs.scala-lang.org/tour/tour-of-scala.html'],
  ['Elixir', 'elixir', 'https://elixir-lang.org/getting-started/introduction.html'],
  ['Dart', 'dart', 'https://dart.dev/language'],
  ['SQL', '\\bsql\\b(?!ite| server)', 'https://www.postgresql.org/docs/current/tutorial-sql.html'],
  ['Bash', 'bash|shell scripting', 'https://www.gnu.org/software/bash/manual/'],
  // Web
  ['React', 'react(?:\\.js|js)?(?! native)', 'https://react.dev/learn'],
  ['React Native', 'react native', 'https://reactnative.dev/docs/getting-started'],
  ['Next.js', 'next\\.?js', 'https://nextjs.org/learn'],
  ['Vue', 'vue(?:\\.js)?', 'https://vuejs.org/guide/introduction.html'],
  ['Angular', 'angular', 'https://angular.dev/tutorials'],
  ['Svelte', 'svelte(?:kit)?', 'https://svelte.dev/tutorial'],
  ['Node.js', 'node(?:\\.js|js)?\\b', 'https://nodejs.org/en/learn'],
  ['Django', 'django', 'https://docs.djangoproject.com/en/stable/intro/tutorial01/'],
  ['FastAPI', 'fastapi', 'https://fastapi.tiangolo.com/tutorial/'],
  ['Flask', 'flask', 'https://flask.palletsprojects.com/tutorial/'],
  ['Spring Boot', 'spring(?: boot)?', 'https://spring.io/guides'],
  ['Ruby on Rails', 'rails|ruby on rails', 'https://guides.rubyonrails.org/getting_started.html'],
  ['GraphQL', 'graphql', 'https://graphql.org/learn/'],
  ['gRPC', 'grpc|protocol buffers|protobuf', 'https://grpc.io/docs/what-is-grpc/introduction/'],
  ['REST APIs', /\bREST(?:ful)?\b|\b[Rr]estful\b|\b[Rr]est API/, 'https://developer.mozilla.org/docs/Glossary/REST'],
  ['HTML & CSS', '\\bhtml5?\\b|\\bcss3?\\b|tailwind', 'https://developer.mozilla.org/docs/Learn'],
  ['Web accessibility', 'accessibility|a11y|wcag', 'https://www.w3.org/WAI/fundamentals/'],
  ['Web performance', 'web performance|core web vitals|lighthouse', 'https://web.dev/learn/performance'],
  // Data stores
  ['PostgreSQL', 'postgres(?:ql)?', 'https://www.postgresql.org/docs/current/tutorial.html'],
  ['MySQL', 'mysql|mariadb', 'https://dev.mysql.com/doc/refman/8.0/en/tutorial.html'],
  ['MongoDB', 'mongo(?:db)?', 'https://www.mongodb.com/docs/manual/tutorial/getting-started/'],
  ['Redis', 'redis', 'https://redis.io/docs/latest/develop/'],
  ['Elasticsearch', 'elastic ?search|opensearch', 'https://www.elastic.co/guide/en/elasticsearch/reference/current/getting-started.html'],
  ['DynamoDB', 'dynamo ?db', 'https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GettingStartedDynamoDB.html'],
  ['Cassandra', 'cassandra', 'https://cassandra.apache.org/doc/latest/'],
  ['SQLite', 'sqlite', 'https://www.sqlite.org/docs.html'],
  // Data & ML
  ['Kafka', 'kafka', 'https://kafka.apache.org/quickstart'],
  ['RabbitMQ', 'rabbitmq|amqp', 'https://www.rabbitmq.com/tutorials'],
  ['Apache Spark', 'spark|pyspark', 'https://spark.apache.org/docs/latest/quick-start.html'],
  ['Airflow', 'airflow', 'https://airflow.apache.org/docs/apache-airflow/stable/tutorial/index.html'],
  ['dbt', '\\bdbt\\b', 'https://docs.getdbt.com/docs/get-started-dbt'],
  ['Snowflake', 'snowflake', 'https://docs.snowflake.com/en/user-guide-getting-started'],
  ['BigQuery', 'bigquery', 'https://cloud.google.com/bigquery/docs/introduction'],
  ['Data modelling', 'data model(?:l)?ing|dimensional model|star schema', 'https://docs.getdbt.com/terms/dimensional-modeling'],
  ['ETL pipelines', '\\betl\\b|\\belt\\b|data pipelines?', 'https://airflow.apache.org/docs/apache-airflow/stable/tutorial/fundamentals.html'],
  ['pandas', 'pandas', 'https://pandas.pydata.org/docs/getting_started/intro_tutorials/'],
  ['PyTorch', 'pytorch|\\btorch\\b', 'https://pytorch.org/tutorials/'],
  ['TensorFlow', 'tensorflow|keras', 'https://www.tensorflow.org/tutorials'],
  ['scikit-learn', 'scikit-learn|sklearn', 'https://scikit-learn.org/stable/tutorial/index.html'],
  ['LLM applications', '\\bllms?\\b|large language models?|rag\\b|retrieval[- ]augmented|prompt engineering|langchain', 'https://docs.anthropic.com/en/docs/intro'],
  ['MLOps', 'mlops|model deployment|ml pipelines|mlflow|kubeflow', 'https://ml-ops.org/'],
  ['Computer vision', 'computer vision|opencv|image recognition', 'https://docs.opencv.org/4.x/d9/df8/tutorial_root.html'],
  ['Statistics', 'statistics|statistical|a/b test', 'https://www.openintro.org/book/os/'],
  // Cloud & ops
  ['AWS', '\\baws\\b|amazon web services|\\bec2\\b|\\bs3\\b|lambda', 'https://aws.amazon.com/getting-started/'],
  ['Google Cloud', '\\bgcp\\b|google cloud', 'https://cloud.google.com/docs/get-started'],
  ['Azure', 'azure', 'https://learn.microsoft.com/training/azure/'],
  ['Docker', 'docker|containers?\\b|containeri[sz]', 'https://docs.docker.com/get-started/'],
  ['Kubernetes', 'kubernetes|\\bk8s\\b|\\beks\\b|\\bgke\\b|\\baks\\b|helm', 'https://kubernetes.io/docs/tutorials/kubernetes-basics/'],
  ['Terraform', 'terraform|infrastructure as code|\\biac\\b|pulumi', 'https://developer.hashicorp.com/terraform/tutorials'],
  ['Ansible', 'ansible', 'https://docs.ansible.com/ansible/latest/getting_started/'],
  ['CI/CD', 'ci/cd|\\bci\\b|continuous (?:integration|delivery|deployment)|github actions|gitlab ci|jenkins|circleci', 'https://docs.github.com/actions/learn-github-actions'],
  ['Linux', 'linux|unix', 'https://linuxjourney.com/'],
  ['Observability', 'observability|monitoring|prometheus|grafana|opentelemetry|datadog|tracing', 'https://opentelemetry.io/docs/what-is-opentelemetry/'],
  ['Networking', 'networking|tcp/ip|\\bdns\\b|load balanc', 'https://www.cloudflare.com/learning/'],
  ['Site reliability', '\\bsre\\b|site reliability|on-?call|incident management|slos?\\b', 'https://sre.google/books/'],
  // Architecture & practice
  ['System design', 'system design|architecture|scalab|high[- ]availability', 'https://github.com/donnemartin/system-design-primer'],
  ['Distributed systems', 'distributed systems?|consensus|replication', 'https://www.distributedsystemscourse.com/'],
  ['Microservices', 'microservices?|service[- ]oriented', 'https://microservices.io/patterns/index.html'],
  ['Event-driven architecture', 'event[- ]driven|event sourcing|cqrs|message queues?|pub/sub', 'https://martinfowler.com/articles/201701-event-driven.html'],
  ['Concurrency', 'concurren|multithread|async(?:hronous)? programming|goroutines', 'https://go.dev/doc/effective_go#concurrency'],
  ['Automated testing', 'unit test|integration test|test automation|\\btdd\\b|jest|pytest|cypress|playwright|selenium', 'https://martinfowler.com/articles/practical-test-pyramid.html'],
  ['Git', '\\bgit\\b|version control', 'https://git-scm.com/book/en/v2'],
  ['Payments', 'payments?|fintech|ledger|pci', 'https://stripe.com/docs/payments'],
  // Security
  ['Application security', 'owasp|appsec|application security|secure coding', 'https://owasp.org/www-project-top-ten/'],
  ['Penetration testing', 'penetration test|pentest|ethical hacking|burp suite|metasploit', 'https://portswigger.net/web-security'],
  ['SIEM', '\\bsiem\\b|splunk|sentinel|elastic security|qradar', 'https://www.splunk.com/en_us/training/free-courses/overview.html'],
  ['Incident response', 'incident response|\\bdfir\\b|forensics|threat hunting', 'https://www.sans.org/white-papers/'],
  ['Cloud security', 'cloud security|\\biam\\b|zero trust', 'https://cloudsecurityalliance.org/research/guidance'],
  ['Compliance (SOC 2 / ISO 27001)', 'soc ?2|iso ?27001|gdpr|hipaa|compliance', 'https://www.aicpa-cima.com/resources/landing/system-and-organization-controls-soc-suite-of-services'],
  ['Cryptography', 'cryptograph|encryption|\\btls\\b|\\bpki\\b', 'https://cryptobook.nakov.com/'],
  ['Network security', 'network security|firewalls?|\\bids\\b|\\bips\\b|wireshark', 'https://www.wireshark.org/docs/'],
  // Mobile & games
  ['iOS', '\\bios\\b|uikit|xcode', 'https://developer.apple.com/tutorials/app-dev-training'],
  ['Android', 'android|jetpack compose', 'https://developer.android.com/courses'],
  ['Flutter', 'flutter', 'https://docs.flutter.dev/get-started/codelab'],
  ['Unity', 'unity(?:3d)?', 'https://learn.unity.com/'],
  ['Unreal Engine', 'unreal', 'https://dev.epicgames.com/community/unreal-engine/learning'],
  ['Godot', 'godot', 'https://docs.godotengine.org/en/stable/getting_started/introduction/'],
  ['Game physics', 'game physics|physics engine|collision detection', 'https://gameprogrammingpatterns.com/'],
  ['Shaders & graphics', 'shaders?|hlsl|glsl|opengl|vulkan|directx', 'https://learnopengl.com/'],
  // Design & product
  ['Figma', 'figma', 'https://help.figma.com/hc/en-us/categories/360002051613'],
  ['Product analytics', 'product analytics|amplitude|mixpanel|google analytics', 'https://amplitude.com/academy'],
];

export interface Skill {
  name: string;
  re: RegExp;
  doc: string | null;
}

export const SKILLS: Skill[] = ENTRIES.map(([name, pattern, doc]) => ({
  name,
  re: pattern instanceof RegExp ? pattern : new RegExp(`(?:^|[^a-z0-9+#])(?:${pattern})`, 'i'),
  doc: doc ?? null,
}));

/** Every lexicon skill a requirement or posting sentence mentions. */
export function skillsIn(text: string): string[] {
  const t = ` ${text} `;
  return SKILLS.filter((s) => s.re.test(t)).map((s) => s.name);
}

export function skillDoc(name: string): string | null {
  return SKILLS.find((s) => s.name.toLowerCase() === name.toLowerCase())?.doc ?? null;
}

/** The depth a requirement asks for, in a few words. */
export function depthOf(text: string): string {
  const t = text.toLowerCase();
  const years = /(\d{1,2})\s*\+?\s*(?:years?|yrs?)/.exec(t);
  if (years) return `${years[1]}+ years`;
  if (/\b(expert|deep|advanced|mastery|extensive)\b/.test(t)) return 'advanced';
  if (/\b(production|in production|at scale|shipped)\b/.test(t)) return 'production experience';
  if (/\b(strong|solid|proficien|hands-on|working knowledge)\b/.test(t)) return 'working proficiency';
  if (/\b(familiar|exposure|basic|understanding|nice to have|bonus|plus)\b/.test(t)) return 'familiarity';
  return 'working proficiency';
}

/** Most common value, ties to the first seen. */
export function mode(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0] ?? '';
  for (const [v, n] of counts) if (n > (counts.get(best) ?? 0)) best = v;
  return best;
}

/** Normalise a free-text requirement into a short label for gaps outside the lexicon. */
export function shortLabel(text: string): string {
  return text
    .replace(/\(.*?\)/g, '')
    .replace(/^(?:\d+\+?\s*(?:years?|yrs?)\s*(?:of\s+)?(?:experience\s+)?(?:with|in|using)?\s*)/i, '')
    .replace(/^(?:experience|familiarity|knowledge|proficiency|expertise)\s+(?:with|in|of)\s+/i, '')
    .replace(/[.;:]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}
