// Auto-generated insurance catalog with 600+ modules across many categories
// Exposes window.INS_CATALOG = [{ name, items: [{ name, price, desc, img }] }]
(function(){
  const CATS = [
    'Health','Car','Life','Property','Travel',
    'Pet','Dental','Vision','Accident','Disability',
    'Cyber','Gadget','Business','Homeowners','Renters'
  ];
  const ADJ = ['Basic','Plus','Premium','Elite','Family','Young Adult','Senior','Traveler','Active','Smart','Secure','Essential','Ultra','Compact','Extended','Shield'];
  const NOUNS = {
    Health: ['Hospital Cash','Surgery Protection','Doctor Visit','Medicine Cover','Wellness','Telehealth','Maternity','Chronic Illness','Mental Health','Vaccination'],
    Car: ['Accident Repair','Theft Protection','Roadside Assistance','Windscreen','Rental Car','Legal Cover','Personal Injury','Third-Party','Tyre & Rim','Key Replacement'],
    Life: ['Life Cover','Funeral Benefit','Income Protection','Critical Illness','Mortgage Protection','Family Support','Education Saver','Term Life','Whole Life','Accidental Death'],
    Property: ['Contents','Fire & Flood','Gadget Protection','Appliance Breakdown','Burglary','Water Damage','Personal Liability','Jewelry','Art & Collectibles','Home Office'],
    Travel: ['Medical Abroad','Flight Delay','Lost Luggage','Adventure Sports','Trip Cancellation','Evacuation','Passport & Docs','Rental Car Damage','Cruise Add-On','Winter Sports'],
    Pet: ['Accident','Illness','Dental','Wellness','Surgery','Vaccination','Third-Party','Boarding','Lost Pet','Senior Care'],
    Dental: ['Cleanings','Fillings','Root Canal','Crown','Orthodontics','Perio','Oral Surgery','Emergency','X-Ray','Implant'],
    Vision: ['Exam','Frames','Lenses','Contacts','Blue Light','LASIK','Replacement','Breakage','Sunwear','Kids Vision'],
    Accident: ['Personal Accident','Income Support','Hospital Lump Sum','Disability Lump Sum','Fracture','Burns','ER Visit','Recovery','Daily Cash','Rehab'],
    Disability: ['Short-Term','Long-Term','Partial','Own Occupation','Any Occupation','Rehab Rider','Cost of Living','Future Increase','Catastrophic','Return to Work'],
    Cyber: ['Identity Theft','Card Fraud','Data Recovery','Ransomware','Online Shopping','Device Malware','Privacy Breach','Family Plan','Dark Web Monitoring','Password Manager'],
    Gadget: ['Phone Damage','Laptop Damage','Wearables','Gaming Console','Camera Gear','Tablet','Headphones','Smart Home','Drone','Portable Speaker'],
    Business: ['General Liability','Property','Business Interruption','Cyber Liability','Professional Indemnity','Workers Comp','Commercial Auto','Stock Cover','Equipment Breakdown','Public Liability'],
    Homeowners: ['Dwelling','Other Structures','Personal Property','Loss of Use','Personal Liability','Medical Payments','Water Backup','Equipment Breakdown','Ordinance or Law','Service Line'],
    Renters: ['Personal Property','Liability','Loss of Use','Theft','Accidental Damage','Pet Damage','Roommate','Identity Theft','Electronics','Bicycle']
  };
  const IMG = (t)=> `https://placehold.co/480x270?text=${encodeURIComponent(t)}`;

  const catalog = [];
  let total = 0;
  for (const cat of CATS){
    const items = [];
    const nouns = NOUNS[cat] || ['Cover'];
    // generate ~40 items per category to exceed 600 total
    for (let i=0; i<40; i++){
      const adj = ADJ[(i + cat.length) % ADJ.length];
      const n = nouns[i % nouns.length];
      const name = `${adj} ${n}`;
      const base = (i+1) * 1.73 + cat.length;
      const price = Math.round(((base % 18) + 2.5) * 100) / 100; // $2.50 - ~$20.50
      const desc = `${cat} module: ${name}. Demo only.`;
      items.push({ name, price, desc, img: IMG(`${cat} ${n}`) });
      total++;
    }
    catalog.push({ name: cat, items });
  }
  try { window.INS_CATALOG = catalog; } catch {}
})();
