// Creates (or removes) fake test students, spread randomly over every
// course, year level and section.
//
//   node scripts/seed-test-students.mjs seed  [--api URL] [--count 100]
//   node scripts/seed-test-students.mjs clean [--api URL]
//         (clean needs ADMIN_USERNAME and ADMIN_PASSWORD in the environment)
//
// Test students use the student IDs PPY-9900001 and up, the usernames
// teststudent001 and up, and the password below, so they are easy to find.

const PASSWORD = process.env.STUDENT_PASSWORD ?? 'student123';
const DEFAULT_API = 'https://gather-school-api.gather-school-api.workers.dev/api';

const FIRST = [
  'Juan', 'Maria', 'Jose', 'Ana', 'Pedro', 'Liza', 'Carlo', 'Angel', 'Mark', 'Jessa',
  'Paolo', 'Kyla', 'Miguel', 'Bianca', 'Gabriel', 'Nicole', 'Rafael', 'Camille', 'Joshua', 'Trisha',
  'Daniel', 'Patricia', 'Christian', 'Danica', 'Francis', 'Hazel', 'Ivan', 'Janine', 'Kenneth', 'Lorraine',
  'Marvin', 'Nadine', 'Oliver', 'Princess', 'Ralph', 'Sheila', 'Timothy', 'Vanessa', 'Wilson', 'Yvonne',
];
const SECOND = ['Mae', 'Grace', 'Joy', 'Rose', 'Anne', 'Marie', 'Luis', 'John', 'Paul', 'James'];
const LAST = [
  'Santos', 'Reyes', 'Cruz', 'Bautista', 'Ocampo', 'Garcia', 'Mendoza', 'Torres', 'Flores', 'Villanueva',
  'Ramos', 'Aquino', 'Castro', 'Rivera', 'Navarro', 'Domingo', 'Soriano', 'Salazar', 'Fernandez', 'Lopez',
  'Dela Cruz', 'Del Rosario', 'De Leon', 'San Jose', 'Pascual', 'Manalo', 'Valdez', 'Tolentino', 'Agustin', 'Mercado',
  'Aguilar', 'Hernandez', 'Padilla', 'Velasco', 'Cabrera', 'Corpuz', 'Dizon', 'Enriquez', 'Gonzales', 'Ignacio',
];
const PREFIXES = [
  '0905', '0906', '0915', '0916', '0917', '0926', '0927', '0935', '0936', '0945',
  '0953', '0955', '0956', '0965', '0975', '0995', '0997', '0918', '0928', '0938',
];

const [command = 'seed', ...rest] = process.argv.slice(2);
const option = (name, fallback) => {
  const index = rest.indexOf(`--${name}`);
  return index >= 0 && rest[index + 1] ? rest[index + 1] : fallback;
};
const api = option('api', DEFAULT_API).replace(/\/+$/, '');
const count = Number(option('count', '100'));

const shuffle = (items) => {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
};
const pick = (items) => items[Math.floor(Math.random() * items.length)];

async function request(method, path, token, body) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  return { status: response.status, data };
}

async function seed() {
  const { status, data } = await request('GET', '/sections');
  if (status !== 200 || !data?.sections?.length) {
    throw new Error(`Could not read the sections from ${api} (HTTP ${status}).`);
  }
  // Every real section, in a random order, so the students are spread everywhere.
  const sections = shuffle(data.sections);
  const names = new Set();
  const numbers = new Set();
  const students = [];
  while (students.length < count) {
    const given = Math.random() < 0.3 ? `${pick(FIRST)} ${pick(SECOND)}` : pick(FIRST);
    const name = `${given} ${pick(LAST)}`;
    const mobile = `${pick(PREFIXES)}${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`;
    if (names.has(name) || numbers.has(mobile)) continue;
    names.add(name);
    numbers.add(mobile);
    students.push({ name, mobile });
  }

  const tally = new Map();
  let created = 0;
  let skipped = 0;
  for (let index = 0; index < students.length; index += 1) {
    const number = String(index + 1).padStart(3, '0');
    const section = sections[index % sections.length];
    const result = await request('POST', '/auth/register', null, {
      username: `teststudent${number}`,
      password: PASSWORD,
      studentNumber: `PPY-99${String(index + 1).padStart(5, '0')}`,
      name: students[index].name,
      course: section.course,
      yearLevel: section.yearLevel,
      section: section.name,
      sectionId: section.id,
      mobile: students[index].mobile,
    });
    if (result.status === 201) {
      created += 1;
      const key = `${section.course} ${section.yearLevel} ${section.name}`;
      tally.set(key, (tally.get(key) ?? 0) + 1);
    } else if (result.status === 409) {
      skipped += 1; // already created by an earlier run
    } else {
      throw new Error(`Student ${number} failed (HTTP ${result.status}): ${JSON.stringify(result.data)}`);
    }
    if ((index + 1) % 20 === 0) console.log(`... ${index + 1} of ${students.length}`);
  }
  console.log(`\nCreated ${created} test students on ${api} (${skipped} already existed).`);
  for (const [key, total] of [...tally.entries()].sort()) console.log(`  ${key}: ${total}`);
  console.log(`\nPassword for all: ${PASSWORD}   Usernames: teststudent001 ...`);
}

async function clean() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) {
    throw new Error('Set ADMIN_USERNAME and ADMIN_PASSWORD to remove the test students.');
  }
  const login = await request('POST', '/auth/login', null, { username, password });
  if (login.status !== 200) throw new Error(`Admin sign-in failed (HTTP ${login.status}).`);
  const token = login.data.token;
  const accounts = await request('GET', '/accounts', token);
  const targets = (accounts.data?.accounts ?? []).filter((account) =>
    /^teststudent\d+$/i.test(account.username),
  );
  let removed = 0;
  for (const account of targets) {
    const result = await request('DELETE', `/admin/users/${encodeURIComponent(account.username)}`, token);
    if (result.status === 200) removed += 1;
    else console.log(`Could not remove ${account.username} (HTTP ${result.status}).`);
  }
  console.log(`Removed ${removed} of ${targets.length} test students from ${api}.`);
}

try {
  if (command === 'seed') await seed();
  else if (command === 'clean') await clean();
  else throw new Error('Use "seed" or "clean".');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
