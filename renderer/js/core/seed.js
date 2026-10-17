// seed.js — the demo org: Brightwave Energy, a (fictional) company that sells solar panels, home and
// commercial batteries, EV chargers, smart-home devices and monitoring software, and installs them.
// Every name, company, email and phone number here is made up. Built from a fixed seed, so a reset
// always gives the same org; dates are relative to today so it always looks current.

// Cities with map coordinates (Field Service draws its map from these).
const CITIES = {
  'San Francisco': [37.7749, -122.4194], Oakland: [37.8044, -122.2712], Berkeley: [37.8715, -122.273], 'San Jose': [37.3382, -121.8863],
  'Palo Alto': [37.4419, -122.143], 'Mountain View': [37.3861, -122.0839], Sunnyvale: [37.3688, -122.0363], Fremont: [37.5485, -121.9886],
  Hayward: [37.6688, -122.0808], 'Walnut Creek': [37.9101, -122.0652], 'Santa Rosa': [38.4404, -122.7141], Sacramento: [38.5816, -121.4944],
  Stockton: [37.9577, -121.2908], Modesto: [37.6391, -120.9969], Napa: [38.2975, -122.2869], 'San Mateo': [37.563, -122.3255],
  Seattle: [47.6062, -122.3321], Denver: [39.7392, -104.9903], Austin: [30.2672, -97.7431], Chicago: [41.8781, -87.6298], Boston: [42.3601, -71.0589],
  London: [51.5072, -0.1276], Toronto: [43.6532, -79.3832], Phoenix: [33.4484, -112.074],
};
const BAY = ['San Francisco', 'Oakland', 'Berkeley', 'San Jose', 'Palo Alto', 'Mountain View', 'Sunnyvale', 'Fremont', 'Hayward', 'Walnut Creek', 'Santa Rosa', 'Sacramento', 'Stockton', 'Modesto', 'Napa', 'San Mateo'];

const Seed = (() => {
  const FIRST = ['Avery', 'Blake', 'Camila', 'Dev', 'Elena', 'Farah', 'Gabe', 'Hana', 'Isaac', 'Jade', 'Kofi', 'Lena', 'Marco', 'Nia', 'Omar', 'Paige', 'Quinn', 'Rosa', 'Sanjay', 'Tess', 'Umar', 'Vera', 'Wes', 'Ximena', 'Yusuf', 'Zoe', 'Aiden', 'Bianca', 'Carter', 'Daria', 'Emil', 'Freya', 'Grant', 'Ines', 'Jonah', 'Kira', 'Liam', 'Mila', 'Noah', 'Olive', 'Priyanka', 'Rafael', 'Sofia', 'Theo', 'Uma', 'Victor', 'Wren', 'Yara'];
  const LAST = ['Adler', 'Bishop', 'Castillo', 'Dawson', 'Ellison', 'Fischer', 'Garcia', 'Hughes', 'Ito', 'Jensen', 'Kowalski', 'Lindqvist', 'Mendes', 'Nakamura', 'Okafor', 'Petrov', 'Quintero', 'Rossi', 'Schmidt', 'Tanaka', 'Underwood', 'Varga', 'Whitfield', 'Xu', 'Young', 'Zimmer', 'Abara', 'Brennan', 'Costa', 'Dubois', 'Esposito', 'Fontaine', 'Gupta', 'Haddad', 'Iyer', 'Kim', 'Larsen', 'Moreau', 'Novak', 'Ortiz', 'Park', 'Reyes', 'Sato', 'Torres', 'Vance', 'Weber'];
  const TITLES = ['CEO', 'CFO', 'COO', 'VP Operations', 'VP Facilities', 'Director of Sustainability', 'Facilities Manager', 'Energy Manager', 'Procurement Lead', 'IT Director', 'Office Manager', 'Head of Real Estate', 'Chief Sustainability Officer', 'Operations Manager', 'Controller'];
  const ACCOUNTS = [
    ['Summit Ridge Hotels', 'Hospitality', 'San Francisco'], ['Bluepine School District', 'Education', 'Sacramento'], ['Harborview Medical', 'Healthcare', 'Oakland'],
    ['Ironclad Manufacturing', 'Manufacturing', 'Fremont'], ['Cedar & Vine Grocers', 'Retail', 'Berkeley'], ['Northgate Logistics', 'Transportation', 'Stockton'],
    ['Lumen Data Centers', 'Technology', 'San Jose'], ['Riverbend Farms', 'Consumer Goods', 'Modesto'], ['Oakline Property Group', 'Financial Services', 'Walnut Creek'],
    ['Coastal Brewing Co.', 'Consumer Goods', 'Santa Rosa'], ['Pinnacle Fitness', 'Hospitality', 'Palo Alto'], ['Meridian Credit Union', 'Financial Services', 'San Mateo'],
    ['Golden Bay Community College', 'Education', 'Hayward'], ['Silverline Transit', 'Transportation', 'Oakland'], ['Evergreen Senior Living', 'Healthcare', 'Walnut Creek'],
    ['Redwood Tech Park', 'Technology', 'Mountain View'], ['Sunset Vineyards', 'Consumer Goods', 'Napa'], ['Atlas Cold Storage', 'Transportation', 'Stockton'],
    ['Beacon Retail Group', 'Retail', 'San Jose'], ['Granite Peak Resorts', 'Hospitality', 'Denver'], ['Clearwater Utilities Co-op', 'Energy', 'Sacramento'],
    ['Foxglove Studios', 'Media', 'San Francisco'], ['Horizon Airport Authority', 'Government', 'San Jose'], ['Juniper Biotech', 'Healthcare', 'Sunnyvale'],
    ['Keel & Co. Auto Group', 'Retail', 'Fremont'], ['Lakeshore Apartments', 'Financial Services', 'Chicago'], ['Maple Street Dental', 'Healthcare', 'Palo Alto'],
    ['Nimbus Software', 'Technology', 'Seattle'], ['Orchard Valley Schools', 'Education', 'Modesto'], ['Prairie Wind Ranch', 'Energy', 'Austin'],
    ['Quarry Hill Builders', 'Manufacturing', 'Phoenix'], ['Rosewood Hospitality', 'Hospitality', 'Boston'], ['Stonebridge Office Parks', 'Financial Services', 'Toronto'],
    ['Tidewater Seafood', 'Consumer Goods', 'Seattle'], ['Union Square Lofts', 'Financial Services', 'San Francisco'], ['Vista Health Clinics', 'Healthcare', 'Hayward'],
    ['Willow Creek Library', 'Government', 'Berkeley'], ['Yellowfield Outfitters', 'Retail', 'London'], ['Zephyr Charging Partners', 'Energy', 'San Mateo'], ['Alder Lane Bakery', 'Consumer Goods', 'Oakland'],
  ];
  const LEAD_COS = ['Brightside Dental', 'Copperline Hotels', 'Driftwood Marina', 'Elmstead Academy', 'Fairhaven Clinics', 'Glasshouse Coffee', 'Highline Gyms', 'Indigo Labs', 'Jetstream Couriers',
    'Kestrel Aviation', 'Lighthouse Church', 'Mosaic Coworking', 'Northwind Storage', 'Opal Spa Resorts', 'Peregrine Farms', 'Quill Publishing', 'Ridgeback Security', 'Saltwater Grill',
    'Thistle Bakeries', 'Upland Water District', 'Valley Vet Group', 'Westbrook Mall', 'Yarrow Organics', 'Zenith Robotics', 'Amberwood HOA', 'Basalt Quarry', 'Canyon Charter School',
    'Delta Freight', 'Ember Ceramics', 'Fernway Nursery'];
  const PRODUCTS = [
    ['Helios 400W Solar Panel', 'HL-400', 'Solar', 289, '☀️', 'A 400-watt monocrystalline panel with a 25-year output warranty. All-black frame, 21.8% efficiency.'],
    ['Helios Commercial Array (100kW)', 'HL-C100', 'Solar', 118000, '🏭', 'A complete 100kW rooftop or ground-mount system for businesses, with racking, inverters and monitoring.'],
    ['Microinverter M2', 'MI-M2', 'Solar', 169, '🔌', 'Panel-level microinverter that keeps the rest of the array producing when one panel is shaded.'],
    ['Solar Carport Kit', 'SC-K1', 'Solar', 42000, '🅿️', 'Turns 10 parking spaces into a solar canopy, pre-wired for EV chargers.'],
    ['VaultCell Home Battery 13kWh', 'VC-13', 'Battery', 8900, '🔋', 'Whole-home backup battery. Stores solar for the evening and keeps the lights on in an outage.'],
    ['VaultCell Commercial 200kWh', 'VC-200', 'Battery', 145000, '🏢', 'Commercial storage that cuts demand charges and backs up critical loads.'],
    ['Battery Expansion Module', 'VC-X5', 'Battery', 3900, '🧱', 'Adds 5kWh to any VaultCell. Stacks up to three modules.'],
    ['ChargeDock Home L2', 'CD-H2', 'EV Charging', 649, '🚗', '48A Level 2 home charger with solar-aware scheduling in the app.'],
    ['ChargeDock Pro Dual', 'CD-PD', 'EV Charging', 4200, '⚡', 'Dual-port networked charger for workplaces and multifamily buildings, with billing built in.'],
    ['DC Fast Charger 150kW', 'CD-DC150', 'EV Charging', 52000, '🚀', 'Adds 200 miles of range in about 15 minutes. For fleets and public sites.'],
    ['Aura Smart Thermostat', 'AU-T1', 'Smart Home', 199, '🌡️', 'Learns your schedule and shifts heating and cooling to the hours your solar produces.'],
    ['Aura Smart Plug (4-pack)', 'AU-P4', 'Smart Home', 59, '🔌', 'Wi-Fi plugs that show what each device costs to run and turn off standby loads.'],
    ['Aura Energy Monitor', 'AU-EM', 'Smart Home', 249, '📟', 'Clamps onto your panel and shows whole-home use in real time.'],
    ['Aura Leak Sensor', 'AU-LS', 'Smart Home', 39, '💧', 'Battery-powered water sensor with instant phone alerts.'],
    ['Brightwave Monitor Cloud (annual)', 'SW-MON', 'Software', 2400, '☁️', 'Fleet-wide monitoring for every panel, battery and charger, with alerts and reports.'],
    ['Fleet Energy Analytics (annual)', 'SW-FEA', 'Software', 18000, '📈', 'Benchmarks sites, forecasts production and finds savings across a portfolio.'],
    ['Demand Response Suite', 'SW-DR', 'Software', 26000, '🎛️', 'Automatically sheds or shifts load during utility peak events and earns incentive payments.'],
    ['Site Survey', 'SV-SS', 'Services', 750, '📐', 'An engineer measures the roof, panel and shading and sends a design within 5 days.'],
    ['Standard Installation', 'SV-INS', 'Services', 3500, '🛠️', 'Licensed installation for home systems, permits included.'],
    ['Commercial Installation', 'SV-CIN', 'Services', 28000, '🏗️', 'Project-managed installation for commercial systems.'],
    ['Annual Maintenance Plan', 'SV-AMP', 'Services', 1200, '🧰', 'Yearly inspection, cleaning and firmware updates.'],
    ['Premier Support (annual)', 'SV-PS', 'Services', 9000, '🛟', '24x7 support line with a 4-hour response time.'],
    ['Brightwave Cable Kit', 'AC-CK', 'Accessories', 79, '🧵', 'MC4 extension cables and connectors.'],
    ['Panel Cleaning Kit', 'AC-PC', 'Accessories', 45, '🧽', 'Soft brush, extension pole and biodegradable cleaner.'],
    ['Brightwave Hoodie', 'AC-HD', 'Accessories', 65, '🧥', 'Organic cotton hoodie. Powered by sunshine.'],
  ];
  const DEALS = [
    ['Rooftop Solar', ['Helios Commercial Array (100kW)', 'Commercial Installation', 'Brightwave Monitor Cloud (annual)']],
    ['Fleet EV Charging', ['DC Fast Charger 150kW', 'ChargeDock Pro Dual', 'Commercial Installation']],
    ['Battery Backup', ['VaultCell Commercial 200kWh', 'Commercial Installation']],
    ['Energy Analytics Platform', ['Fleet Energy Analytics (annual)', 'Brightwave Monitor Cloud (annual)']],
    ['Demand Response Rollout', ['Demand Response Suite', 'Premier Support (annual)']],
    ['Solar Carport', ['Solar Carport Kit', 'ChargeDock Pro Dual', 'Commercial Installation']],
    ['Workplace Charging', ['ChargeDock Pro Dual', 'Standard Installation']],
    ['Support Renewal', ['Premier Support (annual)', 'Annual Maintenance Plan']],
  ];
  const CASES = [
    ['Inverter showing fault code E-21', 'Our Microinverter M2 units show fault E-21 since yesterday and production dropped by half.', 'Defect', 'Problem', 'Microinverter M2'],
    ['Battery not charging from solar', 'VaultCell stays at 12% even on sunny days. The app says "grid charging only".', 'Performance', 'Problem', 'VaultCell Home Battery 13kWh'],
    ['Monitor Cloud login fails', "We can't log in to Monitor Cloud — the password reset email never arrives.", 'Login / Access', 'Problem', 'Brightwave Monitor Cloud (annual)'],
    ['ChargeDock trips the breaker', 'Every time we start charging, the ChargeDock Pro trips the 40A breaker.', 'Defect', 'Problem', 'ChargeDock Pro Dual'],
    ['Where is my order?', 'Our order was placed 9 days ago and still says "Activated". No tracking number yet.', 'Order Status', 'Shipping', null],
    ['Thermostat offline after Wi-Fi change', 'We changed our router and the Aura thermostat shows offline. How do we reconnect it?', 'How-to', 'Question', 'Aura Smart Thermostat'],
    ['Invoice shows wrong tax amount', 'The last invoice charged sales tax on the installation labor, which should be exempt.', 'Invoice', 'Billing', null],
    ['Panel arrived cracked', 'Two of the Helios panels arrived with cracked glass. Photos attached.', 'Damaged Item', 'Returns', 'Helios 400W Solar Panel'],
    ['How do I add a second battery?', 'We want to add storage. Can the expansion module go on our existing VaultCell?', 'How-to', 'Question', 'Battery Expansion Module'],
    ['Production lower than estimate', 'The array has produced 18% less than the design estimate for two months.', 'Performance', 'Problem', 'Helios Commercial Array (100kW)'],
    ['Export data to CSV', 'Can Fleet Energy Analytics export site data to CSV for our finance team?', 'How-to', 'Feature Request', 'Fleet Energy Analytics (annual)'],
    ['DC fast charger stuck at 20 kW', 'The 150kW charger never goes above 20kW, even for cars that support fast charging.', 'Performance', 'Problem', 'DC Fast Charger 150kW'],
    ['Reschedule installation appointment', 'We need to move our installation to the following week.', 'Installation', 'Question', 'Standard Installation'],
    ["Smart plug won't pair", 'The Aura plugs blink blue but never show up in the app.', 'Installation', 'Problem', 'Aura Smart Plug (4-pack)'],
    ["Demand response event didn't trigger", "Yesterday's utility peak event didn't shed any load at our site.", 'Defect', 'Problem', 'Demand Response Suite'],
    ['Refund for returned hoodie', 'I returned the hoodie two weeks ago and have not seen a refund.', 'Other', 'Returns', 'Brightwave Hoodie'],
  ];
  const TONE = {
    Angry: ' This is unacceptable — this is the third time we have reported it and it is still broken. If it is not fixed this week we will cancel the contract.',
    Frustrated: ' We are still waiting on a response and it is still not working. Please help ASAP.',
    Neutral: ' Let us know what you need from us.',
    Positive: ' Thanks so much — your team has been great so far!',
  };
  const ARTICLES = [
    ['Fix inverter fault code E-21', 'Troubleshooting', 'E-21 means the microinverter lost its grid reference.', '1. Check the AC breaker for the solar circuit is on.\n2. Power-cycle: AC off for 5 minutes, then on.\n3. If E-21 returns on one unit, swap it with a neighbour to see if the fault follows the unit.\n4. Still failing? Open a case — the unit is under warranty.'],
    ['Battery only charges from the grid', 'Troubleshooting', 'Usually the battery is in "Backup only" mode or the CT clamps are reversed.', '1. In the app, open Battery › Mode and pick Self-powered.\n2. Check the CT clamp arrows point toward the panel.\n3. Update firmware to 4.2 or later.'],
    ['Reset your Monitor Cloud password', 'Getting Started', 'How to reset a password when the email does not arrive.', '1. Check spam and quarantine folders for no-reply@brightwave.example.\n2. Ask your admin to allow-list the sender.\n3. Admins can send a reset link from Users › Reset password.'],
    ['ChargeDock trips the breaker', 'Troubleshooting', 'The charger draws more than the breaker allows.', '1. In installer settings, set max current to 80% of the breaker (32A on a 40A breaker).\n2. Check torque on the terminal lugs.\n3. A dedicated circuit is required.'],
    ['Track an order', 'Shipping & Returns', 'Where to find tracking and what each status means.', 'Activated = in the warehouse. Shipped = tracking emailed. Delivered = carrier confirmed. Most orders ship in 2–4 business days.'],
    ['Reconnect Aura devices after a Wi-Fi change', 'Getting Started', 'Re-pair thermostats, plugs and monitors to a new network.', '1. Hold the button 10 seconds until the light blinks blue.\n2. In the app tap + › Reconnect device.\n3. Pick the 2.4GHz network — 5GHz-only networks are not supported.'],
    ['Sales tax on installation labor', 'Billing', 'When labor is taxable and how to request a corrected invoice.', 'Installation labor is tax-exempt in most states when billed as a separate line. Ask Billing for a corrected invoice; refunds post in 5–7 days.'],
    ['Report damaged items', 'Shipping & Returns', 'How to get a replacement for something that arrived damaged.', 'Send photos within 14 days. We ship a replacement right away and send a prepaid return label for the damaged item.'],
    ['Add a Battery Expansion Module', 'Getting Started', 'Expanding a VaultCell from 13kWh up to 28kWh.', 'Every VaultCell takes up to three modules. Installation takes about 2 hours and needs a technician visit; firmware 4.0+ is required.'],
    ['Why production is lower than the estimate', 'Troubleshooting', 'Common causes of under-production.', 'Check for new shading, dirty panels and offline microinverters in Monitor Cloud. Weather-adjusted production within 8% of estimate is normal.'],
    ['Export data from Fleet Energy Analytics', 'Integrations', 'Exports, schedules and the API.', 'Reports › Export gives CSV or Excel. Scheduled exports can go to email or S3. Developers can use the REST API.'],
    ['DC fast charger limited to low power', 'Troubleshooting', 'When a 150kW charger delivers much less.', 'Check site power limits in the portal, the cabinet temperature, and the vehicle state of charge — cars slow down above 80%.'],
    ['Reschedule or cancel an installation', 'Field Service', 'Change your installation date.', 'Reply to your confirmation email or call us at least 48 hours before. Rescheduling is free.'],
    ['Pair Aura smart plugs', 'Getting Started', 'Setup steps for Aura plugs.', 'Plugs need 2.4GHz Wi-Fi and Bluetooth on your phone during setup. Keep the phone within 3 metres.'],
    ['How demand response events work', 'Integrations', 'Utility events, opt-outs and payments.', 'The utility sends events 24 hours ahead. Sites shed load by the amount set in Demand Response Suite. Check the event log for opt-outs.'],
    ['Returns and refunds', 'Shipping & Returns', 'Our 30-day return policy.', 'Unused items can be returned within 30 days. Refunds go back to the original payment method within 5–10 business days of us receiving the item.'],
    ['Security at Brightwave', 'Security', 'How we protect your data.', 'Data is encrypted at rest and in transit. We support SSO and two-factor sign-in.'],
    ['Preparing for a site survey', 'Field Service', 'What to have ready for the engineer.', 'Access to the electrical panel, the attic or roof, and the last 12 months of utility bills.'],
  ];

  function build(db) {
    const R = rng(20261017);
    const org = db.org();
    const now = Date.now();
    const ago = (days, hours = R.int(0, 9)) => new Date(now - days * 86400000 - hours * 3600000 - R.int(0, 59) * 60000).toISOString();
    const at = (daysFromNow, hour = 9) => { const d = new Date(); d.setDate(d.getDate() + daysFromNow); d.setHours(hour, R.pick([0, 0, 30]), 0, 0); return d.toISOString(); };
    const mk = (obj, data, daysAgo = R.int(10, 200)) => db.insert(obj, Object.assign({ CreatedDate: ago(daysAgo) }, data), { raw: true });
    const phone = () => `(${R.int(200, 989)}) 555-${String(R.int(100, 9999)).padStart(4, '0')}`;
    const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

    // Users — the current user is Alex Morgan.
    const U = {};
    const user = (key, Name, Title, Role, Department, Region, Quota) => {
      U[key] = mk('User', { Name, Title, Role, Department, Region, Quota, Email: `${Name.toLowerCase().replace(/[^a-z]+/g, '.')}@brightwave.example`, IsActive: true }, 400);
      if (!org.me) org.me = U[key].Id;
      return U[key];
    };
    user('alex', 'Alex Morgan', 'Revenue & Service Lead', 'Admin', 'Sales', 'West', 650000);
    user('priya', 'Priya Raman', 'VP Sales', 'Sales Manager', 'Sales', 'West', 2400000);
    user('jordan', 'Jordan Lee', 'Account Executive', 'Sales Rep', 'Sales', 'Central', 550000);
    user('sam', 'Sam Carter', 'Support Specialist', 'Support Agent', 'Service', 'West');
    user('diego', 'Diego Alvarez', 'Senior Support Engineer', 'Support Agent', 'Service', 'West');
    user('maya', 'Maya Chen', 'Marketing Manager', 'Marketer', 'Marketing', 'West');
    user('nora', 'Nora Patel', 'Dispatch Lead', 'Dispatcher', 'Field Service', 'West');
    const techs = [['Chris Park', ['Solar', 'Electrical'], 'San Jose'], ['Taylor Brooks', ['Battery', 'Electrical', 'EV Charging'], 'Oakland'],
      ['Riley Nguyen', ['EV Charging', 'Networking'], 'Fremont'], ['Morgan Diaz', ['Solar', 'HVAC', 'Battery'], 'Sacramento']]
      .map(([n, skills, city], i) => {
        const u = user('t' + i, n, 'Field Technician', 'Technician', 'Field Service', 'West');
        const [lat, lng] = CITIES[city];
        return mk('ServiceResource', { Name: n, UserId: u.Id, Skills: skills, Territory: city === 'Sacramento' ? 'Sacramento' : 'Bay Area', HomeLat: lat, HomeLng: lng, Vehicle: `Van ${101 + i}`, IsActive: true }, 300);
      });
    const sellers = [[U.alex, 4], [U.jordan, 3], [U.priya, 1]];
    const agents = [[U.sam, 4], [U.diego, 4], [U.alex, 2]];

    // Products
    const P = {};
    for (const [Name, ProductCode, Family, ListPrice, Image, Description] of PRODUCTS) {
      P[Name] = mk('Product2', { Name, ProductCode, Family, ListPrice, Image, Description, IsActive: true, Stock: Family === 'Services' || Family === 'Software' ? null : R.int(0, 400), Rating: Math.round((3.8 + R() * 1.2) * 10) / 10 }, 500);
    }

    // Accounts and contacts
    const accounts = ACCOUNTS.map(([Name, Industry, city], i) => {
      const type = i < 26 ? R.weighted([['Customer - Direct', 6], ['Customer - Channel', 1]]) : R.weighted([['Prospect', 4], ['Partner', 1]]);
      const emp = R.weighted([[R.int(20, 150), 3], [R.int(150, 1500), 4], [R.int(1500, 12000), 2]]);
      return mk('Account', {
        Name, Industry, Type: type, Rating: R.weighted([['Hot', 2], ['Warm', 4], ['Cold', 2]]), NumberOfEmployees: emp,
        AnnualRevenue: Math.round(emp * R.int(90, 420) * 1000 / 1e5) * 1e5, Phone: phone(), Website: `https://www.${slug(Name)}.example`,
        BillingStreet: `${R.int(10, 9800)} ${R.pick(['Market', 'Mission', 'Oak', 'Pine', 'Harbor', 'Main', 'Sunset', 'Elm', 'Valley', 'Ridge'])} ${R.pick(['St', 'Ave', 'Blvd', 'Way'])}`,
        BillingCity: city, BillingState: CITIES[city] && BAY.includes(city) ? 'CA' : '', BillingCountry: ['London'].includes(city) ? 'United Kingdom' : city === 'Toronto' ? 'Canada' : 'United States',
        SLA: type.startsWith('Customer') ? R.weighted([['Platinum', 1], ['Gold', 2], ['Silver', 3], ['Bronze', 2]]) : null,
        CustomerSince: type.startsWith('Customer') ? addDays(today(), -R.int(120, 1600)) : null,
        OwnerId: R.weighted(sellers).Id,
        Description: `${Industry} organisation in ${city}${type.startsWith('Customer') ? ' running Brightwave systems' : ' evaluating Brightwave'}.`,
      }, R.int(200, 700));
    });
    const b2c = mk('Account', { Name: 'Brightwave Online Store (B2C)', Type: 'Customer - Direct', Industry: 'Retail', BillingCity: 'San Francisco', BillingCountry: 'United States', Description: 'Shoppers who buy from the online store.', OwnerId: U.maya.Id }, 600);
    const used = new Set();
    const person = () => { let f, l; do { f = R.pick(FIRST); l = R.pick(LAST); } while (used.has(f + l)); used.add(f + l); return [f, l]; };
    const contacts = [];
    for (const a of accounts) {
      const n = R.int(2, 4);
      for (let i = 0; i < n; i++) {
        const [FirstName, LastName] = person();
        contacts.push(mk('Contact', {
          FirstName, LastName, AccountId: a.Id, Title: i === 0 ? R.pick(['CEO', 'COO', 'VP Operations', 'Director of Sustainability', 'Chief Sustainability Officer']) : R.pick(TITLES),
          Email: `${FirstName}.${LastName}@${slug(a.Name)}.example`.toLowerCase(), Phone: phone(), MobilePhone: R.chance(0.5) ? phone() : null,
          MailingCity: a.BillingCity, MailingCountry: a.BillingCountry, LeadSource: R.pick(SOURCES), OwnerId: a.OwnerId,
        }, R.int(60, 600)));
      }
    }
    const shoppers = [];
    for (let i = 0; i < 22; i++) {
      const [FirstName, LastName] = person();
      const city = R.pick(BAY);
      shoppers.push(mk('Contact', { FirstName, LastName, AccountId: b2c.Id, Title: 'Shopper', Email: `${FirstName}${R.int(1, 99)}@mail.example`.toLowerCase(), Phone: phone(), MailingCity: city, MailingCountry: 'United States', LeadSource: R.pick(['Web', 'Social', 'Email Campaign']), OwnerId: U.maya.Id }, R.int(5, 300)));
    }
    contacts.push(...shoppers);
    const contactsOf = (aid) => contacts.filter((c) => c.AccountId === aid);

    // Campaigns
    const camps = [
      ['Spring Solar Savings', 'Email', 'Completed', -120, -60, 18000, 15500, 420000],
      ['EV Fleet Webinar', 'Webinar', 'Completed', -75, -74, 6000, 5200, 380000],
      ['Energy Summit 2026', 'Conference', 'In Progress', -10, 2, 65000, 48000, 1200000],
      ['Home Battery Launch', 'Social', 'In Progress', -30, 30, 22000, 9000, 260000],
      ['School Districts Go Green', 'Direct Mail', 'Planned', 14, 75, 12000, 0, 500000],
      ['Holiday Smart Home Sale', 'Email', 'Planned', 35, 70, 9000, 0, 150000],
      ['Partner Installer Program', 'Partner', 'In Progress', -60, 120, 30000, 14000, 700000],
      ['Win-back: Lapsed Customers', 'Email', 'Completed', -50, -20, 4000, 3800, 90000],
    ].map(([Name, Type, Status, s, e, BudgetedCost, ActualCost, ExpectedRevenue]) => {
      const sent = Type === 'Email' ? R.int(2500, 9000) : R.int(300, 1800);
      return mk('Campaign', { Name, Type, Status, StartDate: addDays(today(), s), EndDate: addDays(today(), e), BudgetedCost, ActualCost, ExpectedRevenue,
        NumberSent: Status === 'Planned' ? 0 : sent, Opens: Status === 'Planned' ? 0 : Math.round(sent * (0.25 + R() * 0.2)), Clicks: Status === 'Planned' ? 0 : Math.round(sent * (0.03 + R() * 0.05)),
        IsActive: Status !== 'Completed', OwnerId: U.maya.Id, Description: `${Type} campaign: ${Name}.` }, Math.max(1, -s + 20));
    });

    // Leads
    const leads = LEAD_COS.flatMap((Company, i) => {
      const n = i < 30 ? R.int(1, 3) : 1;
      return Array.from({ length: n }, () => {
        const [FirstName, LastName] = person();
        const status = R.weighted([['Open - Not Contacted', 5], ['Working - Contacted', 5], ['Nurturing', 2], ['Closed - Not Converted', 1]]);
        const emp = R.weighted([[R.int(5, 60), 3], [R.int(60, 600), 4], [R.int(600, 5000), 2]]);
        const camp = R.chance(0.45) ? R.pick(camps.filter((c) => c.Status !== 'Planned')) : null;
        return mk('Lead', {
          FirstName, LastName, Company, Title: R.pick(TITLES), Status: status, Rating: R.weighted([['Hot', 2], ['Warm', 4], ['Cold', 3]]),
          LeadSource: camp ? (camp.Type === 'Webinar' ? 'Webinar' : camp.Type === 'Conference' ? 'Trade Show' : 'Email Campaign') : R.pick(SOURCES),
          Industry: R.pick(INDUSTRIES), Email: R.chance(0.92) ? `${FirstName}.${LastName}@${slug(Company)}.example`.toLowerCase() : null, Phone: phone(),
          City: R.pick(BAY), Country: 'United States', NumberOfEmployees: emp, AnnualRevenue: Math.round(emp * R.int(80, 300)) * 1000,
          CampaignId: camp ? camp.Id : null, OwnerId: R.weighted([[U.alex, 3], [U.jordan, 3], [U.priya, 1]]).Id,
          Description: R.pick(['Asked about solar for their main building.', 'Interested in EV charging for staff parking.', 'Wants battery backup after recent outages.', 'Downloaded the ROI calculator.', 'Met us at a trade show booth.', 'Requested a quote online.']),
        }, R.int(1, 60));
      });
    });

    // Campaign members
    for (const c of camps.filter((x) => x.Status !== 'Planned')) {
      const pool = [...R.chance(0.5) ? contacts.slice(0, 60) : shoppers, ...leads];
      const n = R.int(12, 26);
      const seen = new Set();
      for (let i = 0; i < n; i++) {
        const p = R.pick(pool);
        if (seen.has(p.Id)) continue;
        seen.add(p.Id);
        const isLead = p.Id.startsWith('00Q');
        mk('CampaignMember', { CampaignId: c.Id, ContactId: isLead ? null : p.Id, LeadId: isLead ? p.Id : null, Status: R.weighted([['Sent', 4], ['Opened', 3], ['Clicked', 2], ['Responded', 1], ['Attended', c.Type === 'Webinar' || c.Type === 'Conference' ? 2 : 0]]) }, R.int(1, 60));
      }
    }

    // Opportunities with products
    const opps = [];
    for (let i = 0; i < 82; i++) {
      const a = i < accounts.length ? accounts[i] : R.pick(accounts);
      const [deal, items] = R.pick(DEALS);
      const closed = R.chance(0.38);
      const stage = closed ? R.weighted([['Closed Won', 3], ['Closed Lost', 2]]) : R.weighted([['Prospecting', 3], ['Qualification', 4], ['Needs Analysis', 3], ['Value Proposition', 3], ['Proposal/Price Quote', 3], ['Negotiation/Review', 2]]);
      const close = closed ? addDays(today(), -R.int(3, 200)) : R.chance(0.1) ? addDays(today(), -R.int(2, 20)) : addDays(today(), R.int(4, 130));
      const cons = contactsOf(a.Id);
      const scale = R.pick([0.5, 1, 1, 1, 1.5, 2]);
      const lines = items.map((pn) => {
        const p = P[pn];
        const qty = p.ListPrice > 20000 ? Math.max(1, Math.round(scale * R.int(1, 2))) : Math.max(1, Math.round(scale * R.int(2, 12)));
        return { p, qty, price: p.ListPrice, disc: R.weighted([[0, 3], [5, 2], [10, 2], [15, 1]]) };
      });
      const amount = Math.round(sum(lines, (l) => l.qty * l.price * (1 - l.disc / 100)) / 100) * 100;
      const owner = a.OwnerId && R.chance(0.7) ? db.get(a.OwnerId) : R.weighted(sellers);
      const camp = R.chance(0.25) ? R.pick(camps) : null;
      const o = mk('Opportunity', {
        Name: `${a.Name} – ${deal}`, AccountId: a.Id, ContactId: cons.length ? R.pick(cons).Id : null, StageName: stage, Amount: amount, CloseDate: close,
        Probability: STAGE_PROB[stage], Type: deal === 'Support Renewal' ? 'Existing Business - Renewal' : String(a.Type).startsWith('Customer') ? 'Existing Business - Upgrade' : 'New Business',
        LeadSource: camp ? 'Email Campaign' : R.pick(SOURCES), CampaignId: camp ? camp.Id : null,
        NextStep: closed ? null : R.chance(0.8) ? R.pick(['Send revised proposal', 'Site survey scheduled', 'Exec sponsor meeting', 'Security review with IT', 'Finalize financing terms', 'Demo for facilities team', 'Confirm budget with CFO', 'Legal redlines']) : null,
        Competitor: R.weighted([['None', 4], ['SunForge', 2], ['VoltPeak', 2], ['GridNova', 1], ['Local installer', 1]]),
        LossReason: stage === 'Closed Lost' ? R.pick(['Price', 'Features', 'Timing', 'Competitor', 'No Decision']) : null,
        OwnerId: owner.Id, Description: `${deal} for ${a.Name}.`,
      }, closed ? daysBetween(addDays(close, -R.int(20, 90)), today()) : R.int(5, 90));
      for (const l of lines) mk('OpportunityLineItem', { OpportunityId: o.Id, Product2Id: l.p.Id, Quantity: l.qty, UnitPrice: l.price, Discount: l.disc }, 5);
      opps.push(o);
    }
    // Two flagship deals that the demo leans on.
    const big = opps.find((o) => o.AccountId === accounts[0].Id) || opps[0];
    Object.assign(big, { Name: 'Summit Ridge Hotels – Rooftop Solar (12 properties)', StageName: 'Negotiation/Review', Probability: 80, Amount: 1240000, CloseDate: addDays(today(), 12), OwnerId: U.alex.Id, NextStep: 'Final pricing call with CFO on Thursday', Competitor: 'SunForge' });
    const big2 = opps.find((o) => o.AccountId === accounts[6].Id) || opps[1];
    Object.assign(big2, { Name: 'Lumen Data Centers – Battery Backup', StageName: 'Proposal/Price Quote', Probability: 65, Amount: 870000, CloseDate: addDays(today(), 26), OwnerId: U.alex.Id, NextStep: 'Security review with IT', Competitor: 'VoltPeak' });

    // Entitlements for customers
    for (const a of accounts.filter((x) => x.SLA)) {
      const tier = { Platinum: ['24x7 Support', 1, 8], Gold: ['Premier Support', 4, 24], Silver: ['Phone Support', 8, 72], Bronze: ['Web Support', 24, 120] }[a.SLA];
      mk('Entitlement', { Name: `${a.Name} – ${tier[0]}`, AccountId: a.Id, Type: tier[0], ResponseHours: tier[1], ResolveHours: tier[2], StartDate: a.CustomerSince, EndDate: addDays(today(), R.int(-20, 400)) }, 200);
    }

    // Orders: B2B through reps, partners and the ERP; B2C through the storefront.
    const orders = [];
    const order = (acct, contact, channel, daysAgo, items) => {
      const status = daysAgo > 12 ? R.weighted([['Delivered', 8], ['Canceled', 1]]) : daysAgo > 4 ? R.weighted([['Shipped', 3], ['Delivered', 2]]) : R.weighted([['Activated', 3], ['Draft', 1]]);
      const o = mk('Order', {
        AccountId: acct.Id, BillToContactId: contact ? contact.Id : null, Status: status, Channel: channel, EffectiveDate: addDays(today(), -daysAgo),
        ShippingCity: contact ? contact.MailingCity : acct.BillingCity, TrackingNumber: ['Shipped', 'Delivered'].includes(status) ? `1Z${R.int(100000, 999999)}BW${R.int(1000, 9999)}` : null,
        Promo: channel === 'Storefront' && R.chance(0.3) ? R.pick(['SUNNY10', 'FREESHIP', 'BATTERY200']) : null, OwnerId: channel === 'Storefront' ? U.maya.Id : acct.OwnerId,
      }, daysAgo);
      for (const [p, q] of items) mk('OrderItem', { OrderId: o.Id, Product2Id: p.Id, Quantity: q, UnitPrice: p.ListPrice }, daysAgo);
      orders.push(o);
      return o;
    };
    const smallB2B = ['Brightwave Monitor Cloud (annual)', 'Annual Maintenance Plan', 'ChargeDock Pro Dual', 'Battery Expansion Module', 'Helios 400W Solar Panel', 'Premier Support (annual)', 'Microinverter M2'];
    for (let i = 0; i < 34; i++) {
      const a = R.pick(accounts.filter((x) => String(x.Type).startsWith('Customer')));
      const items = Array.from({ length: R.int(1, 3) }, () => { const p = P[R.pick(smallB2B)]; return [p, p.ListPrice > 3000 ? R.int(1, 3) : R.int(4, 40)]; });
      order(a, R.pick(contactsOf(a.Id)) || null, R.weighted([['Sales Rep', 4], ['MuleSoft (ERP)', 3], ['Partner', 1]]), R.int(1, 160), items);
    }
    const shopItems = ['Aura Smart Thermostat', 'Aura Smart Plug (4-pack)', 'Aura Energy Monitor', 'Aura Leak Sensor', 'ChargeDock Home L2', 'Panel Cleaning Kit', 'Brightwave Hoodie', 'Brightwave Cable Kit', 'Helios 400W Solar Panel', 'VaultCell Home Battery 13kWh'];
    for (let i = 0; i < 30; i++) {
      const c = R.pick(shoppers);
      const items = Array.from({ length: R.int(1, 3) }, () => { const p = P[R.pick(shopItems)]; return [p, p.ListPrice > 1000 ? 1 : R.int(1, 3)]; });
      order(b2c, c, 'Storefront', R.int(0, 90), items);
    }

    // Cases with comments
    const custAccts = [...accounts.filter((x) => String(x.Type).startsWith('Customer')), b2c, b2c];
    const cases = [];
    for (let i = 0; i < 118; i++) {
      const t = R.pick(CASES);
      const a = R.pick(custAccts);
      const con = R.pick(contactsOf(a.Id)) || null;
      const daysAgo = R.weighted([[R.int(0, 6), 4], [R.int(7, 30), 4], [R.int(31, 80), 3]]);
      const open = daysAgo < 8 ? R.chance(0.8) : daysAgo < 30 ? R.chance(0.35) : R.chance(0.06);
      const tone = R.weighted([['Neutral', 5], ['Frustrated', 3], ['Angry', 1], ['Positive', 2]]);
      const priority = tone === 'Angry' ? R.weighted([['High', 2], ['Critical', 1]]) : R.weighted([['Low', 2], ['Medium', 5], ['High', 2], ['Critical', 0.4]]);
      const status = open ? (tone === 'Angry' && R.chance(0.5) ? 'Escalated' : R.weighted([['New', 3], ['Working', 4], ['Waiting on Customer', 2]])) : 'Closed';
      const created = ago(daysAgo);
      const ord = t[4] === null && t[2] === 'Order Status' ? R.pick(orders.filter((o) => o.AccountId === a.Id) || []) : null;
      const hours = { Critical: 8, High: 24, Medium: 72, Low: 120 }[priority];
      const desc = t[1] + TONE[tone];
      const c = mk('Case', {
        Subject: t[0], Description: desc, Reason: t[2], Type: t[3], ProductId: t[4] ? P[t[4]].Id : null, OrderId: ord ? ord.Id : null,
        AccountId: a.Id, ContactId: con ? con.Id : null, Status: status, Priority: priority,
        Origin: R.weighted([['Email', 4], ['Web', 4], ['Phone', 2], ['Chat', 2], ['Agentforce', 1]]),
        Queue: t[2] === 'Damaged Item' || t[3] === 'Returns' ? 'Returns' : t[3] === 'Billing' ? 'Billing' : priority === 'Critical' ? 'Tier 2' : R.weighted([['Tier 1', 3], ['Tier 2', 1], ['Field Service', t[2] === 'Installation' ? 2 : 0]]),
        SlaDue: new Date(new Date(created).getTime() + hours * 3600000).toISOString(), Sentiment: Predict.sentiment(desc),
        ClosedDate: status === 'Closed' ? new Date(new Date(created).getTime() + R.int(2, 96) * 3600000).toISOString() : null,
        CSAT: status === 'Closed' && R.chance(0.7) ? R.weighted([[5, 5], [4, 4], [3, 2], [2, 1], [1, tone === 'Angry' ? 2 : 0.3]]) : null,
        OwnerId: R.weighted(agents).Id, CreatedDate: created,
      }, daysAgo);
      cases.push(c);
      const n = R.int(0, 4);
      let t0 = new Date(created).getTime();
      for (let k = 0; k < n; k++) {
        t0 += R.int(1, 30) * 3600000;
        if (t0 > now) break;
        const theirs = k % 2 === 1;
        db.insert('CaseComment', {
          ParentId: c.Id, IsPublished: true, FromCustomer: theirs, CreatedById: theirs ? null : c.OwnerId, CreatedDate: new Date(t0).toISOString(),
          CommentBody: theirs ? R.pick(['Any update on this?', 'Attached the photos you asked for.', 'Still happening this morning.', 'Thanks, that worked!', 'We tried that and it did not help.', 'Can someone call me? This is urgent.'])
            : R.pick(['Thanks for reporting this — could you send a photo of the display?', 'I have escalated this to our engineering team.', 'Please try power-cycling the unit and let me know.', 'A technician can visit on Thursday. Does that work?', 'I have issued a replacement; tracking to follow.', 'Following up — is this still happening?']),
        }, { raw: true });
      }
    }

    // Knowledge
    for (const [Title, Category, Summary, Body] of ARTICLES) {
      mk('Knowledge', { Title, Category, Summary, Body, UrlName: Title.toLowerCase().replace(/[^a-z0-9]+/g, '-'), PublishStatus: R.chance(0.88) ? 'Published' : 'Draft', Views: R.int(40, 4200), Helpful: R.int(2, 300), OwnerId: R.pick([U.sam, U.diego]).Id }, R.int(30, 400));
    }

    // Work orders across the Bay Area
    const bayAccts = accounts.filter((a) => BAY.includes(a.BillingCity));
    const woTypes = [['Installation', 'Install', 'Solar'], ['Installation', 'Install EV chargers', 'EV Charging'], ['Repair', 'Repair inverter', 'Solar'], ['Maintenance', 'Annual maintenance visit', 'Solar'],
      ['Inspection', 'Post-install inspection', 'Electrical'], ['Upgrade', 'Add battery module', 'Battery'], ['Repair', 'Charger diagnostics', 'EV Charging'], ['Installation', 'Install battery backup', 'Battery']];
    for (let i = 0; i < 42; i++) {
      const a = R.pick(bayAccts);
      const [WorkType, subj, Skill] = R.pick(woTypes);
      const day = R.int(-12, 8);
      const tech = R.chance(0.82) || day < 0 ? R.pick(techs.filter((t) => t.Skills.includes(Skill)).concat(techs[0])) : null;
      const status = !tech ? 'New' : day < 0 ? R.weighted([['Completed', 8], ['Cannot Complete', 1]]) : day === 0 ? R.weighted([['In Progress', 2], ['Dispatched', 2], ['Completed', 1]]) : day <= 2 ? 'Dispatched' : 'Scheduled';
      const [lat, lng] = CITIES[a.BillingCity];
      const rel = cases.find((c) => c.AccountId === a.Id && ['Defect', 'Installation', 'Performance'].includes(c.Reason));
      mk('WorkOrder', {
        Subject: `${subj} – ${a.Name}`, WorkType, Skill, AccountId: a.Id, CaseId: rel && R.chance(0.4) ? rel.Id : null, ResourceId: tech ? tech.Id : null, Status: status,
        Priority: R.weighted([['Low', 2], ['Medium', 5], ['High', 2], ['Critical', 0.5]]), ScheduledStart: tech || day >= 0 ? at(day, R.pick([8, 9, 10, 11, 13, 14, 15])) : null,
        DurationHours: WorkType === 'Installation' ? R.pick([3, 4, 6]) : R.pick([1, 2, 2, 3]), City: a.BillingCity,
        Lat: lat + (R() - 0.5) * 0.05, Lng: lng + (R() - 0.5) * 0.05, Description: `${subj} at ${a.Name}, ${a.BillingCity}.`,
        CompletionNotes: status === 'Completed' ? R.pick(['Replaced faulty unit, system producing normally.', 'Installed and commissioned. Customer walked through the app.', 'Cleaned panels and updated firmware.', 'Tightened lugs, set max current to 32A.']) : null,
      }, Math.max(1, -day + R.int(3, 15)));
    }

    // Tasks, events and emails
    const taskSubjects = ['Call to discuss proposal', 'Send pricing follow-up', 'Prep for exec meeting', 'Check in after site survey', 'Confirm budget timeline', 'Send case study', 'Follow up on demo', 'Schedule security review'];
    for (const o of opps.filter((x) => !x.StageName.startsWith('Closed'))) {
      const n = R.int(0, 2);
      for (let i = 0; i < n; i++) {
        const due = R.int(-6, 10);
        mk('Task', { Subject: R.pick(taskSubjects), Type: R.pick(['Call', 'Email', 'To Do', 'Follow Up']), Status: due < -2 && R.chance(0.6) ? 'Completed' : R.weighted([['Not Started', 3], ['In Progress', 1]]),
          Priority: R.weighted([['High', 1], ['Normal', 3], ['Low', 1]]), ActivityDate: addDays(today(), due), WhatId: o.Id, WhoId: o.ContactId, OwnerId: o.OwnerId }, R.int(1, 20));
      }
    }
    for (const l of leads.filter((x) => x.Status !== 'Closed - Not Converted').slice(0, 30)) {
      if (R.chance(0.5)) mk('Task', { Subject: R.pick(['Intro call', 'Send ROI calculator', 'Qualify budget and timeline', 'Connect on LinkedIn']), Type: 'Call', Status: R.weighted([['Not Started', 3], ['Completed', 1]]), Priority: l.Rating === 'Hot' ? 'High' : 'Normal', ActivityDate: addDays(today(), R.int(-4, 6)), WhoId: l.Id, OwnerId: l.OwnerId }, R.int(1, 10));
    }
    for (const c of cases.filter((x) => x.Status !== 'Closed').slice(0, 18)) {
      mk('Task', { Subject: R.pick(['Call customer with update', 'Check with engineering', 'Confirm fix with customer']), Type: 'Call', Status: 'Not Started', Priority: c.Priority === 'Critical' || c.Priority === 'High' ? 'High' : 'Normal', ActivityDate: addDays(today(), R.int(-1, 3)), WhatId: c.Id, WhoId: c.ContactId, OwnerId: c.OwnerId }, R.int(0, 4));
    }
    // Meetings fall on weekdays, and Alex gets a steady run of them so "My calendar" has a real week.
    const weekday = (d) => { const dow = new Date(Date.now() + d * 86400000).getDay(); return dow === 6 ? d + 2 : dow === 0 ? d + 1 : d; };
    // Alex's days: three this week so far, the rest over the coming two weeks.
    const alexDays = [-5, -4, -2, -1, 0, 1, 2, 3, 4, 5, 7, 8, 10];
    for (let i = 0; i < 26 + alexDays.length; i++) {
      const o = R.pick(opps.filter((x) => !x.StageName.startsWith('Closed')));
      const mine = i >= 26;
      const d = weekday(mine ? alexDays[i - 26] : R.int(-10, 12));
      const start = at(d, R.pick([9, 10, 11, 13, 14, 15, 16]));
      mk('Event', { Subject: R.pick(['Discovery call', 'Proposal review', 'Site walk-through', 'Exec sponsor meeting', 'Demo: Monitor Cloud', 'Financing options review']) + ' – ' + db.name(o.AccountId),
        StartDateTime: start, EndDateTime: new Date(new Date(start).getTime() + R.pick([30, 60, 60, 90]) * 60000).toISOString(), Location: R.pick(['Zoom', 'Customer site', 'Brightwave HQ', 'Phone']),
        WhatId: o.Id, WhoId: o.ContactId, OwnerId: mine ? U.alex.Id : o.OwnerId }, Math.max(0, -d + 3));
    }
    for (const o of opps.slice(0, 30)) {
      const con = db.get(o.ContactId);
      if (!con) continue;
      const d = R.int(1, 30);
      mk('EmailMessage', { Subject: R.pick(['Re: Proposal for ', 'Next steps – ', 'Pricing for ', 'Following up: ']) + o.Name.split(' – ')[1], ToAddress: con.Email, FromName: db.name(o.OwnerId), Incoming: R.chance(0.35), Status: 'Sent',
        TextBody: R.pick(['Thanks for the time today. Attached is the updated proposal with the financing options we discussed.', 'Could we get 30 minutes with your facilities team next week?', 'Our board approved the budget — can you send the final contract?', 'We are comparing two vendors and need the warranty terms in writing.']),
        RelatedToId: o.Id, WhoId: con.Id, MessageDate: ago(d) }, d);
    }

    // Marketing: segments, journeys, templates
    const seg = (Name, Source, filters, Description) => mk('Segment', { Name, Source, Criteria: { filters }, Description, LastRefreshed: ago(1) }, 40);
    const segHome = seg('Online shoppers in the Bay Area', 'Contact', [['AccountId', 'eq', b2c.Id]], 'Everyone who bought from the storefront.');
    const segExec = seg('Sustainability leaders', 'Contact', [['Title', 'contains', 'Sustainability']], 'Sustainability directors and officers at accounts.');
    const segHot = seg('Hot open leads', 'Lead', [['Rating', 'eq', 'Hot'], ['Status', 'notin', ['Closed - Converted', 'Closed - Not Converted']]], 'Hot leads not yet converted.');
    seg('Education decision makers', 'Lead', [['Industry', 'eq', 'Education']], 'Schools and colleges.');
    seg('High-value customers (Data Cloud)', 'Unified Profile', [['ltv', 'gt', 5000]], 'Unified profiles with lifetime value over $5K.');
    seg('Cart abandoners (7 days)', 'Unified Profile', [['abandoned', 'gt', 0]], 'Abandoned a cart in the last 7 days.');
    const tpl = (Name, Folder, Tone, Subject, Body) => mk('EmailTemplate', { Name, Folder, Tone, Subject, Body }, 60);
    tpl('Battery launch announcement', 'Marketing', 'Friendly', 'Keep the lights on with VaultCell, {!FirstName}', 'Hi {!FirstName},\n\nOutages are getting longer. VaultCell stores your solar and switches on in milliseconds when the grid goes down.\n\nThis month: $200 off with code BATTERY200.\n\n— The Brightwave team');
    tpl('Webinar invite', 'Marketing', 'Professional', 'Webinar: electrifying your fleet', 'Hi {!FirstName},\n\nJoin our 30-minute webinar on planning fleet charging — sizing, incentives and utility make-ready programs.');
    tpl('Proposal follow-up', 'Sales', 'Professional', 'Next steps on your proposal', 'Hi {!FirstName},\n\nThanks again for your time. I have attached the proposal we discussed. Could we find 20 minutes this week to go over it?\n\nBest,\n{!$User.Name}');
    tpl('Case resolved', 'Service', 'Friendly', 'Your case {!CaseNumber} is resolved', 'Hi {!Contact.FirstName},\n\nGood news — your case "{!Subject}" is resolved. Reply to this email if anything comes up again.');
    tpl('Order shipped', 'Commerce', 'Playful', 'Your order is on its way ☀️', 'Your Brightwave order {!OrderNumber} has shipped! Tracking: {!TrackingNumber}.');
    tpl('We miss you', 'Marketing', 'Friendly', 'It has been a while, {!FirstName}', 'Here is 10% off your next order with code SUNNY10.');
    const step = (type, label, config = {}) => ({ id: 's' + R.int(1e5, 9e5), type, label, config });
    const jr = (Name, Status, SegmentId, CampaignId, Goal, Entered, Converted, Steps, Description) => mk('Journey', { Name, Status, SegmentId, CampaignId, Goal, Entered, Converted, Steps, Description }, 30);
    jr('Home Battery Launch nurture', 'Running', segHome.Id, camps[3].Id, 'Order a VaultCell', 1840, 96, [
      step('email', 'Launch announcement', { template: 'Battery launch announcement' }), step('wait', 'Wait 3 days', { days: 3 }),
      step('split', 'Opened the email?', { yes: 'Send case study', no: 'Resend with new subject' }), step('email', 'Customer story: 3-day outage', {}),
      step('wait', 'Wait 4 days', { days: 4 }), step('sms', 'Offer reminder', { text: 'Your $200 VaultCell offer ends Sunday.' }), step('task', 'Sales call for high scorers', { owner: 'Lead owner' }),
    ], 'Nurtures storefront customers toward a home battery.');
    jr('Hot lead fast track', 'Running', segHot.Id, null, 'Meeting booked', 312, 41, [
      step('task', 'Call within 1 hour', {}), step('email', 'Intro + ROI calculator', {}), step('wait', 'Wait 2 days', { days: 2 }), step('slack', 'Alert owner in #sales-team', {}),
    ], 'Hot leads get a call and an email the same day.');
    jr('Sustainability leaders – Energy Summit', 'Paused', segExec.Id, camps[2].Id, 'Register for the summit', 240, 38, [step('email', 'Summit invite', {}), step('wait', 'Wait 5 days', { days: 5 }), step('email', 'Speaker lineup', {})], 'Invites sustainability leaders to the summit.');
    jr('Win-back series', 'Draft', null, camps[7].Id, 'Second purchase', 0, 0, [step('email', 'We miss you', { template: 'We miss you' })], 'Brings back customers who have not ordered in 6 months.');

    // MuleSoft integrations, runs and APIs
    const integ = (Name, Status, Source, Target, Trigger, Steps, Description) => mk('Integration', { Name, Status, Source, Target, Trigger, Steps, Description, Runs: 0, LastRun: null }, 120);
    const ints = [
      integ('ERP order sync', 'Running', 'LedgerOne ERP', 'Stratus Orders', 'Schedule', [
        { type: 'source', label: 'LedgerOne: new sales orders', config: { system: 'LedgerOne ERP', op: 'GET /sales-orders?since=lastRun' } },
        { type: 'transform', label: 'Map to Order', config: { mapping: { customer_name: 'AccountId (match by name)', order_date: 'EffectiveDate', status: 'Status', lines: 'OrderItem[]' } } },
        { type: 'filter', label: 'Skip test orders', config: { cond: 'customer_name does not contain "TEST"' } },
        { type: 'target', label: 'Upsert Orders', config: { object: 'Order', op: 'upsert', key: 'OrderNumber' } }], 'Pulls B2B orders from the ERP every 15 minutes.'),
      integ('Shipping updates', 'Running', 'ShipFast WMS', 'Stratus Orders', 'Event', [
        { type: 'source', label: 'ShipFast: shipment events', config: { system: 'ShipFast WMS', op: 'webhook /shipments' } },
        { type: 'transform', label: 'Tracking → Order', config: { mapping: { tracking: 'TrackingNumber', state: 'Status' } } },
        { type: 'target', label: 'Update Orders', config: { object: 'Order', op: 'update', key: 'OrderNumber' } }], 'Writes tracking numbers back to orders.'),
      integ('Inverter alerts to cases', 'Running', 'HeliosLink Telemetry', 'Stratus Cases', 'Event', [
        { type: 'source', label: 'HeliosLink: device faults', config: { system: 'HeliosLink Telemetry', op: 'stream /faults' } },
        { type: 'filter', label: 'Only repeat faults', config: { cond: 'fault_count >= 3 in 24h' } },
        { type: 'transform', label: 'Fault → Case', config: { mapping: { site: 'AccountId', code: 'Subject', detail: 'Description' } } },
        { type: 'target', label: 'Create Case', config: { object: 'Case', op: 'insert' } }], 'Opens a case when a site reports repeated inverter faults.'),
      integ('Payments reconciliation', 'Error', 'PayBridge', 'Stratus Orders', 'Schedule', [
        { type: 'source', label: 'PayBridge: settlements', config: { system: 'PayBridge', op: 'GET /settlements' } },
        { type: 'transform', label: 'Match to order', config: { mapping: { order_ref: 'OrderNumber', amount: 'TotalAmount' } } },
        { type: 'target', label: 'Update Orders', config: { object: 'Order', op: 'update', key: 'OrderNumber' } }], 'Marks storefront orders as paid.'),
      integ('Web form leads', 'Paused', 'Website forms', 'Stratus Leads', 'API call', [
        { type: 'source', label: 'POST /leads', config: { system: 'Website forms', op: 'POST /api/leads' } },
        { type: 'transform', label: 'Form → Lead', config: { mapping: { full_name: 'FirstName + LastName', company: 'Company', email: 'Email', interest: 'Description' } } },
        { type: 'target', label: 'Create Lead', config: { object: 'Lead', op: 'insert' } }], 'Creates leads from the website quote form.'),
    ];
    for (const it of ints) {
      for (let i = 0; i < R.int(6, 14); i++) {
        const failed = it.Status === 'Error' ? R.chance(0.6) : R.chance(0.06);
        org.runs.push({ id: 'run' + R.int(1e6, 9e6), integrationId: it.Id, at: ago(R.int(0, 3), R.int(0, 23)), status: failed ? 'Failed' : 'Success', records: failed ? 0 : R.int(1, 60), ms: R.int(300, 4200),
          error: failed ? R.pick(['401 Unauthorized from PayBridge — API key expired', 'Timeout after 30s calling /settlements', 'Order 00010042 not found']) : null });
      }
      it.Runs = org.runs.filter((r) => r.integrationId === it.Id).length;
      it.LastRun = org.runs.filter((r) => r.integrationId === it.Id).map((r) => r.at).sort().pop();
    }
    org.runs.sort((a, b) => b.at.localeCompare(a.at));
    org.apis = [
      { id: 'api1', name: 'Orders System API', version: 'v2', layer: 'System', base: '/api/orders', methods: ['GET', 'POST', 'PATCH'], status: 'Live', consumers: 4, calls24h: 18240, p95: 210, errors: 0.3 },
      { id: 'api2', name: 'Customer Process API', version: 'v1', layer: 'Process', base: '/api/customers', methods: ['GET'], status: 'Live', consumers: 6, calls24h: 40210, p95: 160, errors: 0.1 },
      { id: 'api3', name: 'Device Telemetry API', version: 'v3', layer: 'System', base: '/api/telemetry', methods: ['GET', 'POST'], status: 'Live', consumers: 2, calls24h: 912000, p95: 45, errors: 0.02 },
      { id: 'api4', name: 'Mobile Experience API', version: 'v1', layer: 'Experience', base: '/api/mobile', methods: ['GET', 'POST'], status: 'Live', consumers: 1, calls24h: 65400, p95: 240, errors: 0.8 },
      { id: 'api5', name: 'Payments System API', version: 'v1', layer: 'System', base: '/api/payments', methods: ['GET'], status: 'Degraded', consumers: 2, calls24h: 3100, p95: 2900, errors: 12.4 },
      { id: 'api6', name: 'Partner Installer API', version: 'beta', layer: 'Experience', base: '/api/partners', methods: ['GET', 'POST'], status: 'Design', consumers: 0, calls24h: 0, p95: 0, errors: 0 },
    ];

    // Data Cloud: engagement events and outside records waiting for identity resolution.
    const evTypes = [['Web visit', 'Web', 6], ['Email open', 'Email', 5], ['Email click', 'Email', 2], ['App login', 'Mobile', 3], ['Cart abandoned', 'Web', 1], ['Support chat', 'Chat', 1], ['Product view', 'Web', 4]];
    const evPages = ['/battery', '/solar-calculator', '/shop/thermostat', '/ev-charging', '/financing', '/shop/chargedock-home', '/pricing'];
    for (const c of [...shoppers, ...contacts.slice(0, 50)]) {
      const n = c.AccountId === b2c.Id ? R.int(6, 22) : R.int(0, 8);
      for (let i = 0; i < n; i++) {
        const [type, channel] = R.weighted(evTypes.map((e) => [e, e[2]]));
        org.events.push({ id: 'ev' + org.events.length, contactId: c.Id, type, channel, at: ago(R.int(0, 60), R.int(0, 23)), detail: type.includes('Email') ? R.pick(['Battery launch', 'Webinar invite', 'Newsletter']) : R.pick(evPages), value: type === 'Cart abandoned' ? R.pick([199, 249, 649, 8900]) : null });
      }
    }
    org.events.sort((a, b) => b.at.localeCompare(a.at));
    for (const c of shoppers.concat(contacts.slice(0, 12))) {
      if (R.chance(0.55)) org.sources.push({ id: 'src' + org.sources.length, source: 'Mobile App', name: `${c.FirstName} ${c.LastName}`, email: c.Email, phone: null, device: R.pick(['iPhone', 'Android']), loyalty: null });
      if (R.chance(0.4)) org.sources.push({ id: 'src' + org.sources.length, source: 'In-store POS', name: `${c.FirstName[0]}. ${c.LastName}`, email: null, phone: c.Phone, device: null, loyalty: 'BW' + R.int(10000, 99999) });
      if (R.chance(0.3)) org.sources.push({ id: 'src' + org.sources.length, source: 'Web Analytics', name: null, email: c.Email.toUpperCase(), phone: null, device: R.pick(['Chrome · Mac', 'Safari · iPhone', 'Edge · Windows']), loyalty: null });
    }
    for (let i = 0; i < 9; i++) {
      const [f, l] = person();
      org.sources.push({ id: 'src' + org.sources.length, source: R.pick(['Mobile App', 'In-store POS', 'Web Analytics']), name: `${f} ${l}`, email: `${f}.${l}@mail.example`.toLowerCase(), phone: R.chance(0.5) ? phone() : null, device: null, loyalty: null });
    }
    org.streams = [
      { id: 'ds1', name: 'CRM Contacts & Accounts', source: 'Stratus CRM', category: 'Profile', object: 'Contact', status: 'Active', refresh: 'Every hour' },
      { id: 'ds2', name: 'Storefront Orders', source: 'Commerce', category: 'Engagement', object: 'Order', status: 'Active', refresh: 'Real time' },
      { id: 'ds3', name: 'Service Cases', source: 'Stratus CRM', category: 'Engagement', object: 'Case', status: 'Active', refresh: 'Every hour' },
      { id: 'ds4', name: 'Web & Mobile Engagement', source: 'Web/Mobile SDK', category: 'Engagement', object: 'events', status: 'Active', refresh: 'Real time' },
      { id: 'ds5', name: 'Mobile App Profiles', source: 'Mobile App', category: 'Profile', object: 'sources', status: 'Active', refresh: 'Every 15 min' },
      { id: 'ds6', name: 'In-store POS', source: 'POS (via MuleSoft)', category: 'Profile', object: 'sources', status: 'Active', refresh: 'Daily' },
    ];

    // Slack
    const C = (n, topic, members) => db.slackChannel(n, { topic, members: members.map((u) => u.Id), raw: true });
    C('general', 'Company-wide announcements', Object.values(U));
    C('wins', '🎉 Closed deals — automated by Flow', [U.alex, U.priya, U.jordan, U.maya]);
    C('sales-team', 'Pipeline, deals and help', [U.alex, U.priya, U.jordan]);
    C('support-escalations', 'Critical and escalated cases', [U.alex, U.sam, U.diego]);
    C('field-ops', 'Dispatch and technicians', [U.nora, U.alex, ...Object.keys(U).filter((k) => k[0] === 't').map((k) => U[k])]);
    C('marketing', 'Campaigns and journeys', [U.maya, U.alex, U.priya]);
    const deal = db.slackChannel('deal-summit-ridge-hotels', { topic: 'Deal room: ' + big.Name, recordId: big.Id, members: [U.alex.Id, U.priya.Id, U.diego.Id], raw: true });
    const say = (ch, u, text, d, h, extra = {}) => db.slackPost(ch, text, u.Id || u, Object.assign({ at: ago(d, h), raw: true }, extra));
    say('general', U.priya, 'Welcome to Stratus, everyone 👋 Pipeline, cases and orders all live here now.', 20, 3);
    say('general', U.maya, 'Energy Summit booth is confirmed — we have 3 speaking slots. Sign-up sheet in #marketing.', 6, 5);
    say('general', U.nora, 'Reminder: heat advisory Thursday, techs start at 7am to beat the afternoon.', 2, 2);
    for (const o of opps.filter((x) => x.StageName === 'Closed Won').slice(0, 6)) say('wins', 'bot:Flow', `🎉 ${db.name(o.OwnerId)} closed [[${o.Id}]] for ${fmt.money(o.Amount)}!`, daysBetween(o.CloseDate, today()), 1, { recordId: o.Id });
    say('sales-team', U.priya, `Big week: [[${big.Id}]] is in negotiation and [[${big2.Id}]] has proposal out. Let's swarm on both.`, 3, 4);
    say('sales-team', U.jordan, 'Anyone have a good case study for cold storage? Atlas Cold Storage asked for one.', 2, 6);
    say('sales-team', U.alex, 'Riverbend Farms one-pager works — same refrigeration load profile.', 2, 5);
    say('sales-team', U.priya, 'Forecast call moves to Friday 10am this week.', 1, 8);
    for (const c of cases.filter((x) => x.Status === 'Escalated' || x.Priority === 'Critical').slice(0, 5)) say('support-escalations', 'bot:Flow', `🚨 Case [[${c.Id}]] – ${c.Subject} (${db.name(c.AccountId)}) is ${c.Priority}.`, R.int(0, 6), 2, { recordId: c.Id });
    say('support-escalations', U.diego, 'Seeing a cluster of E-21 inverter faults after the 4.1 firmware. Engineering is looking.', 1, 3);
    say('support-escalations', U.sam, 'I linked the KB article "Fix inverter fault code E-21" in all the open ones.', 1, 2);
    say('field-ops', U.nora, 'Two new installs came in for Fremont — Riley can you take the Thursday slot?', 1, 6);
    say('field-ops', U.t2 || U.nora, 'Yes, Thursday works 👍', 1, 5);
    say('field-ops', U.t0 || U.nora, 'Summit Ridge rooftop survey done. Photos uploaded to the work order.', 0, 3);
    say('marketing', U.maya, 'Home Battery Launch journey: 1,840 entered, 5.2% converted so far. Subject line B is winning.', 2, 3);
    say('marketing', U.priya, 'Can we target the schools campaign at districts with outages last year?', 1, 4);
    say(deal.id, U.alex, `Deal room for [[${big.Id}]]. CFO wants pricing for 12 properties with financing.`, 4, 6);
    say(deal.id, U.priya, 'SunForge came in 8% lower. Lead with our 25-year warranty and Monitor Cloud.', 3, 5);
    say(deal.id, U.diego, 'FYI they have one open support case about an older array — make sure it is resolved before signature.', 2, 3);
    // Alex has caught up everywhere except escalations and field ops, so a fresh org shows two unread channels.
    for (const n of ['general', 'wins', 'sales-team', 'marketing', deal.id]) { const ch = db.channel(n); if (ch) ch.lastRead = Object.assign(ch.lastRead || {}, { [U.alex.Id]: new Date(now).toISOString() }); }

    // Chatter
    for (const o of [big, big2]) db.post(o.Id, R.pick(['Legal has the MSA. Expect redlines Monday.', 'Exec sponsor confirmed for the final call.', 'Site survey photos look great — no structural issues.']), U.priya.Id, { raw: true, at: ago(2) });
    db.post(accounts[0].Id, 'Renewal of the Premier Support plan is due next quarter.', U.alex.Id, { raw: true, at: ago(5) });
    db.post(null, '👏 Shout-out to Diego for turning around three critical cases yesterday.', U.priya.Id, { raw: true, at: ago(1) });

    // Reports and dashboards
    const rep = (name, folder, object, o) => db.cfg.list('reports').push(Object.assign({ id: 'rp' + slug(name).slice(0, 18), name, folder, object, filters: [], columns: null, chart: null, createdAt: ago(60) }, o)) && db.cfg.list('reports').slice(-1)[0];
    const r1 = rep('Pipeline by Stage', 'Sales', 'Opportunity', { filters: [['StageName', 'notin', ['Closed Won', 'Closed Lost']]], groupBy: 'StageName', aggregate: { fn: 'sum', field: 'Amount' }, chart: 'funnel', columns: ['Name', 'AccountId', 'Amount', 'CloseDate', 'OwnerId'] });
    const r2 = rep('Closed Won by Month', 'Sales', 'Opportunity', { filters: [['StageName', 'eq', 'Closed Won']], groupBy: 'CloseDate:month', aggregate: { fn: 'sum', field: 'Amount' }, chart: 'line', columns: ['Name', 'AccountId', 'Amount', 'CloseDate'] });
    const r3 = rep('Pipeline by Owner', 'Sales', 'Opportunity', { filters: [['StageName', 'notin', ['Closed Won', 'Closed Lost']]], groupBy: 'OwnerId', groupBy2: 'StageName', aggregate: { fn: 'sum', field: 'Amount' }, chart: 'hbar', columns: ['Name', 'StageName', 'Amount', 'CloseDate'] });
    const r4 = rep('Leads by Source', 'Marketing', 'Lead', { groupBy: 'LeadSource', aggregate: { fn: 'count' }, chart: 'donut', columns: ['Name', 'Company', 'Status', 'Rating', 'Score'] });
    const r5 = rep('Open Cases by Priority', 'Service', 'Case', { filters: [['Status', 'ne', 'Closed']], groupBy: 'Priority', aggregate: { fn: 'count' }, chart: 'bar', columns: ['CaseNumber', 'Subject', 'AccountId', 'Status', 'OwnerId'] });
    const r6 = rep('Cases by Origin', 'Service', 'Case', { groupBy: 'Origin', aggregate: { fn: 'count' }, chart: 'donut', columns: ['CaseNumber', 'Subject', 'Status'] });
    const r7 = rep('Cases by Reason', 'Service', 'Case', { groupBy: 'Reason', aggregate: { fn: 'count' }, chart: 'hbar', columns: ['CaseNumber', 'Subject', 'Status', 'Priority'] });
    const r8 = rep('CSAT by Agent', 'Service', 'Case', { filters: [['CSAT', 'notnull']], groupBy: 'OwnerId', aggregate: { fn: 'avg', field: 'CSAT' }, chart: 'bar', columns: ['CaseNumber', 'Subject', 'CSAT'] });
    const r9 = rep('Orders by Channel', 'Commerce', 'Order', { filters: [['Status', 'ne', 'Canceled']], groupBy: 'Channel', aggregate: { fn: 'sum', field: 'TotalAmount' }, chart: 'donut', columns: ['OrderNumber', 'AccountId', 'Status', 'TotalAmount', 'EffectiveDate'] });
    const r10 = rep('Pipeline by Product Family', 'Sales', 'OpportunityLineItem', { groupBy: 'Product2Id.Family', aggregate: { fn: 'sum', field: 'TotalPrice' }, chart: 'bar', columns: ['Product2Id', 'OpportunityId', 'Quantity', 'TotalPrice'] });
    const r11 = rep('Work Orders by Status', 'Field Service', 'WorkOrder', { groupBy: 'Status', aggregate: { fn: 'count' }, chart: 'bar', columns: ['WorkOrderNumber', 'Subject', 'ResourceId', 'ScheduledStart'] });
    rep('Campaign ROI', 'Marketing', 'Campaign', { columns: ['Name', 'Type', 'Status', 'BudgetedCost', 'ActualCost', 'ExpectedRevenue'], sort: 'ExpectedRevenue', dir: 'desc' });
    rep('Top Accounts by Revenue', 'Sales', 'Account', { columns: ['Name', 'Industry', 'AnnualRevenue', 'Type', 'OwnerId'], sort: 'AnnualRevenue', dir: 'desc' });
    const r14 = rep('Storefront Revenue by Month', 'Commerce', 'Order', { filters: [['Channel', 'eq', 'Storefront'], ['Status', 'ne', 'Canceled']], groupBy: 'EffectiveDate:month', aggregate: { fn: 'sum', field: 'TotalAmount' }, chart: 'line', columns: ['OrderNumber', 'BillToContactId', 'TotalAmount', 'EffectiveDate'] });
    const dash = (name, folder, components) => db.cfg.list('dashboards').push({ id: 'db' + slug(name).slice(0, 18), name, folder, components, createdAt: ago(60) });
    dash('Sales Pipeline', 'Sales', [{ reportId: r1.id, type: 'metric', title: 'Open pipeline' }, { reportId: r2.id, type: 'metric', title: 'Closed won (all time)' }, { reportId: r1.id, title: 'Pipeline by stage' }, { reportId: r2.id, title: 'Closed won by month' }, { reportId: r3.id, title: 'Pipeline by owner' }, { reportId: r10.id, title: 'By product family' }]);
    dash('Service Overview', 'Service', [{ reportId: r5.id, type: 'metric', title: 'Open cases' }, { reportId: r8.id, type: 'metric', title: 'Avg CSAT' }, { reportId: r5.id, title: 'Open by priority' }, { reportId: r6.id, title: 'By origin' }, { reportId: r7.id, title: 'By reason' }, { reportId: r8.id, title: 'CSAT by agent' }]);
    dash('Executive Summary', 'Exec', [{ reportId: r2.id, type: 'metric', title: 'Closed won' }, { reportId: r9.id, type: 'metric', title: 'Order revenue' }, { reportId: r5.id, type: 'metric', title: 'Open cases' }, { reportId: r2.id, title: 'Bookings trend' }, { reportId: r9.id, title: 'Orders by channel' }, { reportId: r14.id, title: 'Storefront revenue' }, { reportId: r4.id, title: 'Leads by source' }, { reportId: r11.id, title: 'Work orders' }]);

    // Flows
    org.flows.push(
      { id: 'fl1', name: 'Celebrate Closed Won', object: 'Opportunity', trigger: 'update', active: true, conditions: [['StageName', 'eq', 'Closed Won']], description: 'Posts the win to #wins and creates an onboarding task.',
        actions: [{ type: 'slack', channel: 'wins', text: '🎉 {!Owner.Name} closed {!Name} for {!Amount}!' }, { type: 'task', subject: 'Kick off onboarding for {!Account.Name}', days: 2, priority: 'High' }] },
      { id: 'fl2', name: 'Escalate critical cases', object: 'Case', trigger: 'both', active: true, conditions: [['Priority', 'eq', 'Critical']], description: 'Alerts #support-escalations and routes to Tier 2.',
        actions: [{ type: 'slack', channel: 'support-escalations', text: '🚨 Critical case {!CaseNumber} – {!Subject} ({!Account.Name})' }, { type: 'update', field: 'Queue', value: 'Tier 2' }] },
      { id: 'fl3', name: 'Hot lead follow-up', object: 'Lead', trigger: 'both', active: true, conditions: [['Rating', 'eq', 'Hot']], description: 'Gives the owner a same-day call task.',
        actions: [{ type: 'task', subject: 'Call {!Name} at {!Company} today', days: 0, priority: 'High' }] },
      { id: 'fl4', name: 'Damaged items go to Returns', object: 'Case', trigger: 'create', active: true, conditions: [['Reason', 'eq', 'Damaged Item']], description: 'Routes damaged-item cases to the Returns queue.',
        actions: [{ type: 'update', field: 'Queue', value: 'Returns' }] },
      { id: 'fl5', name: '✨ Summarize new cases', object: 'Case', trigger: 'create', active: false, conditions: [], description: 'AI writes a two-sentence summary for the agent who picks it up. Turn it on to try it.',
        actions: [{ type: 'ai', prompt: 'Summarize this case in two sentences for the support agent who picks it up: what is wrong and what the customer wants.', field: 'Summary' }] },
      { id: 'fl6', name: 'Work order completed', object: 'WorkOrder', trigger: 'update', active: true, conditions: [['Status', 'eq', 'Completed']], description: 'Posts the completion notes to the record feed and #field-ops.',
        actions: [{ type: 'chatter', text: '✅ Work completed: {!CompletionNotes}' }, { type: 'slack', channel: 'field-ops', text: '✅ {!WorkOrderNumber} done at {!Account.Name}: {!CompletionNotes}' }] },
    );

    // Prompt Builder templates
    org.prompts.push(
      { id: 'pt1', name: 'Sales follow-up email', type: 'Sales Email', object: 'Opportunity', template: 'Write a short follow-up email from {!$User.Name} to {!Contact.Name} ({!Contact.Title}) at {!Account.Name} about "{!Name}". Stage: {!StageName}. Next step: {!NextStep}. Under 120 words, warm, one clear ask.' },
      { id: 'pt2', name: 'Case reply', type: 'Service Reply', object: 'Case', template: 'Draft a reply to {!Contact.Name} about case {!CaseNumber}: "{!Subject}". What they said: {!Description}. They sound {!Sentiment}. Acknowledge how they feel, give clear next steps, and sign as {!$User.Name}.' },
      { id: 'pt3', name: 'Account brief', type: 'Record Summary', object: 'Account', template: 'Write a one-paragraph brief on {!Name} ({!Industry}, {!BillingCity}) for a rep meeting them tomorrow: relationship, open deals, open cases and one risk.' },
      { id: 'pt4', name: 'Deal coach', type: 'Flex', object: 'Opportunity', template: 'You are a sales coach. Deal: {!Name}, {!Amount}, stage {!StageName}, closes {!CloseDate}, competitor {!Competitor}. Give the 3 things the rep should do this week to win.' },
      { id: 'pt5', name: 'Product description', type: 'Field Generation', object: 'Product2', field: 'Description', template: 'Write a 2-sentence storefront description for {!Name} ({!Family}, {!ListPrice}). Friendly, concrete, no hype words.' },
      { id: 'pt6', name: 'Lead outreach', type: 'Sales Email', object: 'Lead', template: 'Write a first-touch email to {!Name}, {!Title} at {!Company} ({!Industry}). Context: {!Description}. Under 90 words, end with a question.' },
    );

    // Agents (Agentforce)
    org.agents.push(
      { id: 'ag1', name: 'Agentforce Assistant', kind: 'employee', active: true, icon: '🤖', tone: 'Concise and friendly',
        role: 'An assistant for Brightwave employees. Looks things up, updates records, logs activity, drafts emails and posts to Slack.',
        instructions: 'Always look records up before changing them. Confirm what you changed. Never invent record Ids. Use the smallest number of steps.',
        actions: ['query', 'get', 'search', 'create', 'update', 'log_task', 'draft_email', 'post_slack', 'report', 'navigate', 'knowledge'],
        topics: [{ name: 'Sales', desc: 'Pipeline, deals, leads and forecasts.' }, { name: 'Service', desc: 'Cases, knowledge and SLAs.' }, { name: 'Field Service', desc: 'Work orders and technicians.' }, { name: 'Commerce', desc: 'Orders and products.' }] },
      { id: 'ag2', name: 'Customer Service Agent', kind: 'customer', active: true, icon: '🛟', tone: 'Warm, patient and clear',
        role: 'Talks to Brightwave customers on the website. Answers from Knowledge, checks order status, and opens a case when it cannot solve something.',
        instructions: 'Only share information about the signed-in customer. Answer from Knowledge articles when you can. Open a case when the issue needs a person, and give the case number. Never promise refunds.',
        actions: ['knowledge', 'order_status', 'create_case', 'query'],
        topics: [{ name: 'Orders', desc: 'Where is my order, returns, refunds.' }, { name: 'Troubleshooting', desc: 'Devices, app, batteries, chargers.' }] },
      { id: 'ag3', name: 'SDR Agent', kind: 'employee', active: true, icon: '📞', tone: 'Upbeat and brief',
        role: 'Works new leads: qualifies them, writes outreach, books follow-ups.',
        instructions: 'Prioritise leads by Einstein score. Draft outreach, log a task for every lead you touch, and update lead status when qualified.',
        actions: ['query', 'get', 'update', 'log_task', 'draft_email', 'post_slack'],
        topics: [{ name: 'Lead qualification', desc: 'Score, qualify and route leads.' }] },
    );

    // Tableau Pulse metrics and saved workbooks
    org.metrics.push(
      { id: 'm1', name: 'Closed Won Revenue', object: 'Opportunity', filters: [['StageName', 'eq', 'Closed Won']], dateField: 'CloseDate', agg: { fn: 'sum', field: 'Amount' }, format: 'currency', good: 'up', goal: 900000 },
      { id: 'm2', name: 'New Cases', object: 'Case', filters: [], dateField: 'CreatedDate', agg: { fn: 'count' }, format: 'number', good: 'down' },
      { id: 'm3', name: 'Storefront Revenue', object: 'Order', filters: [['Channel', 'eq', 'Storefront'], ['Status', 'ne', 'Canceled']], dateField: 'EffectiveDate', agg: { fn: 'sum', field: 'TotalAmount' }, format: 'currency', good: 'up' },
      { id: 'm4', name: 'Average CSAT', object: 'Case', filters: [['CSAT', 'notnull']], dateField: 'ClosedDate', agg: { fn: 'avg', field: 'CSAT' }, format: 'number', good: 'up', goal: 4.3 },
      { id: 'm5', name: 'New Leads', object: 'Lead', filters: [], dateField: 'CreatedDate', agg: { fn: 'count' }, format: 'number', good: 'up' },
      { id: 'm6', name: 'Work Orders Completed', object: 'WorkOrder', filters: [['Status', 'eq', 'Completed']], dateField: 'ScheduledStart', agg: { fn: 'count' }, format: 'number', good: 'up' },
    );
    org.workbooks.push(
      { id: 'wb1', name: 'Pipeline by stage and owner', question: 'Open pipeline by stage, split by owner', spec: { object: 'Opportunity', filters: [['StageName', 'notin', ['Closed Won', 'Closed Lost']]], groupBy: 'StageName', groupBy2: 'OwnerId', aggregate: { fn: 'sum', field: 'Amount' }, chart: 'stacked' } },
      { id: 'wb2', name: 'Cases by product', question: 'Which products have the most cases?', spec: { object: 'Case', filters: [['ProductId', 'notnull']], groupBy: 'ProductId', aggregate: { fn: 'count' }, chart: 'hbar' } },
      { id: 'wb3', name: 'Revenue by industry', question: 'Closed won revenue by account industry', spec: { object: 'Opportunity', filters: [['StageName', 'eq', 'Closed Won']], groupBy: 'Account.Industry', aggregate: { fn: 'sum', field: 'Amount' }, chart: 'bar' } },
    );

    org.recent = [big.Id, big2.Id, accounts[0].Id, cases[0].Id, leads[0].Id];
    org.prefs = { agentPanel: false };
  }

  return { build };
})();
