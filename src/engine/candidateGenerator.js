import { COMPANIES, LOCATIONS, STARTUPS } from './vocabulary.js';

// Deterministic PRNG (mulberry32) so every seed run produces the same pool.
function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST_NAMES = ['Aarav', 'Maya', 'Liam', 'Priya', 'Noah', 'Sofia', 'Ethan', 'Ananya', 'Lucas', 'Chloe', 'Arjun', 'Emma', 'Mateo', 'Zara', 'Daniel', 'Isha', 'Owen', 'Hannah', 'Kabir', 'Grace', 'Leo', 'Meera', 'Samuel', 'Nina', 'Rohan', 'Ava', 'Julian', 'Sara', 'Vikram', 'Elena', 'Omar', 'Leah', 'Tariq', 'Mia', 'Dev', 'Ruby', 'Felix', 'Aisha', 'Hugo', 'Kavya'];
const LAST_NAMES = ['Sharma', 'Johnson', 'Chen', 'Patel', 'Garcia', 'Nguyen', 'Williams', 'Reddy', 'Kim', 'Muller', 'Rossi', 'Iyer', 'Brown', 'Singh', 'Lopez', 'Okafor', 'Davis', 'Khan', 'Silva', 'Novak', 'Martin', 'Rao', 'Clark', 'Fischer', 'Ahmed', 'Taylor', 'Menon', 'Walker', 'Haddad', 'Moreau'];

const PROFILES = [
  { title: 'Frontend Engineer', core: ['JavaScript', 'TypeScript', 'React', 'CSS'], extra: ['Redux', 'Next.js', 'GraphQL', 'Vue', 'Angular', 'Tailwind', 'Cypress', 'Node.js', 'Figma', 'Playwright'] },
  { title: 'Backend Engineer', core: ['Node.js', 'SQL'], extra: ['TypeScript', 'Express', 'PostgreSQL', 'MongoDB', 'Redis', 'Kafka', 'Docker', 'AWS', 'GraphQL', 'Java', 'Spring', 'Go', 'Python', 'Kubernetes'] },
  { title: 'Full Stack Engineer', core: ['JavaScript', 'React', 'Node.js'], extra: ['TypeScript', 'Next.js', 'Express', 'PostgreSQL', 'MongoDB', 'GraphQL', 'AWS', 'Docker', 'Redux', 'CSS', 'Tailwind'] },
  { title: 'Mobile Engineer', core: ['React Native'], extra: ['Swift', 'Kotlin', 'TypeScript', 'JavaScript', 'GraphQL', 'Redux', 'Figma'] },
  { title: 'Data Engineer', core: ['Python', 'SQL'], extra: ['Spark', 'Airflow', 'Kafka', 'AWS', 'GCP', 'PostgreSQL', 'Docker', 'Terraform', 'Java'] },
  { title: 'Data Scientist', core: ['Python', 'SQL'], extra: ['PyTorch', 'TensorFlow', 'Spark', 'AWS', 'GCP', 'Airflow'] },
  { title: 'Machine Learning Engineer', core: ['Python', 'PyTorch'], extra: ['TensorFlow', 'Docker', 'Kubernetes', 'AWS', 'GCP', 'Spark', 'Go', 'SQL'] },
  { title: 'DevOps Engineer', core: ['Docker', 'Kubernetes'], extra: ['AWS', 'GCP', 'Azure', 'Terraform', 'Python', 'Go', 'Kafka', 'PostgreSQL'] },
  { title: 'QA Engineer', core: ['Selenium'], extra: ['Cypress', 'Playwright', 'JavaScript', 'TypeScript', 'Java', 'Python', 'SQL'] },
  { title: 'Product Manager', core: ['Product Strategy'], extra: ['SQL', 'Figma'] },
  { title: 'Product Designer', core: ['Figma'], extra: ['CSS', 'Product Strategy'] },
];

const EDUCATION = ['B.Tech, Computer Science', 'BSc, Computer Science', 'MSc, Software Engineering', 'BE, Electronics', 'MS, Data Science', 'BA, Design', 'MBA', 'BSc, Mathematics', 'Self-taught / bootcamp'];

const CITIES = Object.entries(LOCATIONS)
  .filter(([, location]) => location.kind === 'city')
  .map(([city, location]) => ({ city, country: location.country }));
const EMPLOYERS = [...Object.keys(COMPANIES), ...STARTUPS];

export function generateCandidates(count = 400, seed = 20251006) {
  const random = createRandom(seed);
  const pick = (items) => items[Math.floor(random() * items.length)];
  const pickSome = (items, min, max) => {
    const shuffled = [...items].sort(() => random() - 0.5);
    return shuffled.slice(0, min + Math.floor(random() * (max - min + 1)));
  };
  const currentYear = 2026;

  return Array.from({ length: count }, (_, index) => {
    const profile = pick(PROFILES);
    const firstName = pick(FIRST_NAMES);
    const lastName = pick(LAST_NAMES);
    // Skew towards 2–10 years, the range most searches target.
    const yearsExperience = Math.min(20, Math.floor(random() * random() * 22) + Math.floor(random() * 4));
    const seniority = yearsExperience < 2 ? 'junior' : yearsExperience < 5 ? 'mid' : yearsExperience < 9 ? 'senior' : 'lead';
    const { city, country } = pick(CITIES);
    const company = pick(EMPLOYERS);

    const skills = [...new Set([...profile.core.filter(() => random() < 0.85), ...pickSome(profile.extra, 2, 5)])];

    // 0–3 previous roles, walking backwards in time
    const history = [];
    let end = currentYear - 1 - Math.floor(random() * 3);
    const previousRoles = yearsExperience < 2 ? 0 : Math.min(3, 1 + Math.floor(random() * 3));
    for (let i = 0; i < previousRoles && end > currentYear - yearsExperience; i++) {
      const start = Math.max(currentYear - yearsExperience, end - 1 - Math.floor(random() * 4));
      const previousTitle = random() < 0.75 ? profile.title : pick(PROFILES).title;
      history.push({ title: previousTitle, company: pick(EMPLOYERS.filter((name) => name !== company)), startYear: start, endYear: end });
      end = start;
    }

    const seniorityLabel = { junior: 'Junior', mid: '', senior: 'Senior', lead: 'Lead' }[seniority];
    return {
      fullName: `${firstName} ${lastName}`,
      headline: `${seniorityLabel ? `${seniorityLabel} ` : ''}${profile.title} at ${company}`,
      title: profile.title,
      seniority,
      company,
      city,
      country,
      remote: random() < 0.35,
      yearsExperience,
      skills,
      history,
      education: pick(EDUCATION),
      email: `${firstName}.${lastName}.${index}@example.com`.toLowerCase(),
      openToWork: random() < 0.3,
    };
  });
}
