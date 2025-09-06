// Demo product catalog (placeholder images), enriched as policy-like items
const DEMO_PRODUCTS = [
  { id: 'p-001', name: 'Minimal Tee', category: 'apparel', brand: 'NovaWear', price: 24.00, img: 'https://placehold.co/800x600?text=Minimal+Tee', desc: 'Soft cotton tee with a clean silhouette.', provider:'Nova Mutual', rating:4.4, coverageLimit:25000, monthlyPremium:24, termMonths:12, deductible:250, benefits:['Accidental damage','Extended returns'], exclusions:['Intentional damage'], eligibility:['18+','USA resident'], claimProcess:'File online, decision in 48h' },
  { id: 'p-002', name: 'Everyday Hoodie', category: 'apparel', brand: 'NovaWear', price: 49.00, img: 'https://placehold.co/800x600?text=Everyday+Hoodie', desc: 'Cozy fleece hoodie for all seasons.', provider:'Nova Mutual', rating:4.5, coverageLimit:35000, monthlyPremium:29, termMonths:12, deductible:300, benefits:['Wear & tear coverage','Fast replacements'], exclusions:['Commercial use'], eligibility:['18+'], claimProcess:'Chat + upload receipt' },
  { id: 'p-003', name: 'Ceramic Mug', category: 'home', brand: 'HomeCo', price: 12.00, img: 'https://placehold.co/800x600?text=Ceramic+Mug', desc: 'Matte glaze ceramic mug, 12oz.', provider:'Home Shield', rating:4.1, coverageLimit:15000, monthlyPremium:10, termMonths:12, deductible:100, benefits:['Breakage coverage'], exclusions:['Negligence'], eligibility:['18+'], claimProcess:'App + photo proof' },
  { id: 'p-004', name: 'Throw Pillow', category: 'home', brand: 'HomeCo', price: 18.00, img: 'https://placehold.co/800x600?text=Throw+Pillow', desc: 'Plush pillow with removable cover.', provider:'Home Shield', rating:4.2, coverageLimit:18000, monthlyPremium:12, termMonths:12, deductible:120, benefits:['Spill protection'], exclusions:['Mold'], eligibility:['18+'], claimProcess:'Online form' },
  { id: 'p-005', name: 'Wireless Buds', category: 'gadgets', brand: 'Techify', price: 79.00, img: 'https://placehold.co/800x600?text=Wireless+Buds', desc: 'Compact earbuds with long battery.', provider:'Tech Assure', rating:4.6, coverageLimit:50000, monthlyPremium:19, termMonths:12, deductible:200, benefits:['Loss & theft','Battery replacement'], exclusions:['Custom mods'], eligibility:['18+'], claimProcess:'Self‑service portal' },
  { id: 'p-006', name: 'Smart Lamp', category: 'gadgets', brand: 'Techify', price: 39.00, img: 'https://placehold.co/800x600?text=Smart+Lamp', desc: 'Touch-dim lamp with warm/cool modes.', provider:'Tech Assure', rating:4.3, coverageLimit:30000, monthlyPremium:14, termMonths:12, deductible:150, benefits:['Power surge'], exclusions:['Improper wiring'], eligibility:['18+'], claimProcess:'Phone + courier pickup' },
  { id: 'p-007', name: 'Notebook Set', category: 'home', brand: 'Paperly', price: 14.00, img: 'https://placehold.co/800x600?text=Notebook+Set', desc: 'Dot-grid notebooks (set of 2).', provider:'Home Shield', rating:4.0, coverageLimit:12000, monthlyPremium:9, termMonths:12, deductible:90, benefits:['Water damage'], exclusions:['Arson'], eligibility:['18+'], claimProcess:'Web form' },
  { id: 'p-008', name: 'Athletic Cap', category: 'apparel', brand: 'NovaWear', price: 22.00, img: 'https://placehold.co/800x600?text=Athletic+Cap', desc: 'Breathable cap with adjustable fit.', provider:'Nova Mutual', rating:4.2, coverageLimit:20000, monthlyPremium:11, termMonths:12, deductible:120, benefits:['Loss protection'], exclusions:['Abuse'], eligibility:['18+'], claimProcess:'Mobile app' },
  { id: 'p-009', name: 'Desk Mat', category: 'home', brand: 'DeskPro', price: 28.00, img: 'https://placehold.co/800x600?text=Desk+Mat', desc: 'PU leather desk mat, 80×30cm.', provider:'Home Shield', rating:4.1, coverageLimit:22000, monthlyPremium:13, termMonths:12, deductible:140, benefits:['Spill & stain'], exclusions:['Pet damage'], eligibility:['18+'], claimProcess:'App + courier' },
  { id: 'p-010', name: 'Action Camera', category: 'gadgets', brand: 'Techify', price: 119.00, img: 'https://placehold.co/800x600?text=Action+Camera', desc: 'Water-resistant 4K action cam.', provider:'Tech Assure', rating:4.7, coverageLimit:80000, monthlyPremium:32, termMonths:12, deductible:300, benefits:['Accident + theft','Travel protection'], exclusions:['Racing'], eligibility:['18+'], claimProcess:'24/7 hotline' }
];

// Append up to 400 total items (p-011..p-400) with varied names/categories/brands/prices
// Deterministic generation so values remain stable across reloads, and enrich with policy-like fields
(function(){
  const brands = ['NovaWear','HomeCo','Techify','Paperly','DeskPro','UrbanTrail','AquaPure','SoundWave','GlowLite','GreenNest','CafeCraft','PixelWorks','ZenGear'];
  const categories = ['apparel','home','gadgets'];
  for (let i=11; i<=400; i++){
    const id = `p-${String(i).padStart(3,'0')}`;
    const cat = categories[i % categories.length];
    const brand = brands[i % brands.length];
    const base = 9 + (i * 1.7); // varied but bounded
    const price = Math.round((base % 160 + 9) * 100) / 100; // between ~$9 and ~$169
    const noun = cat==='apparel' ? ['Tee','Hoodie','Cap','Jacket','Socks','Joggers','Polo']
                 : cat==='home' ? ['Mug','Pillow','Planter','Throw','Towel','Kettle','Frame']
                 : ['Buds','Lamp','Keyboard','Mouse','Speaker','Camera','Stand'];
    const adj = ['Classic','Premium','Eco','Ultra','City','Travel','Everyday','Compact','Modern','Soft','Bold','Lite'];
    const name = `${adj[i % adj.length]} ${noun[i % noun.length]}`;
    const imgText = encodeURIComponent(`${name} ${brand}`);
    const img = `https://placehold.co/800x600?text=${imgText}`;
    const desc = `Demo ${cat} item by ${brand}. Great quality at a friendly price.`;
    // Enriched policy-like fields
    const provider = (cat==='gadgets') ? 'Tech Assure' : (cat==='home') ? 'Home Shield' : 'Nova Mutual';
    const rating = Math.round(((3.8 + (i % 20) * 0.07) % 4.9 + 3.5) * 10) / 10;
    const coverageLimit = 10000 + (i % 50) * 2000; // $10k–$110k
    const monthlyPremium = Math.max(8, Math.round(((price/4) + (i % 7))));
    const termMonths = 12;
    const deductible = Math.max(75, Math.round((price * 2)));
    const benefits = [
      'Accidental damage',
      (cat==='gadgets')?'Theft & loss':'Water damage',
      (cat==='home')?'Fire & smoke':'Extended warranty'
    ];
    const exclusions = [
      'Intentional damage',
      (cat==='gadgets')?'Jailbreak/mods':'Negligence'
    ];
    const eligibility = ['18+','Valid ID'];
    const claimProcess = (cat==='gadgets')?'Self-service portal':'Online form';
    DEMO_PRODUCTS.push({ id, name, category: cat, brand, price, img, desc, provider, rating, coverageLimit, monthlyPremium, termMonths, deductible, benefits, exclusions, eligibility, claimProcess });
  }
})();

