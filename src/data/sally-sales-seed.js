// Sally's pipeline, migrated from her Excel tracker (28 May 2026) into a
// CUSTOMER-CENTRIC model: each customer carries its own activity history
// (calls / visits / notes) under `_activities`. The backend splits these into
// the `customers` and `activities` collections on seed. Owner = 'sally'.

// Sally's known monthly results from your records (April 2026 = 5 sales, ~D32,500 = 5 × D6,500).
// Used to seed the Report's monthly history. Current/future months compute live from Won customers.
export const sallyMonthlyHistory = [
  { month: '2026-04', sales: 5, revenue: 32500 },
]

export const sallyCustomers = [
  // ---- Businesses she's targeting (from Master Prospects) ----
  { company: 'Ayoub Furniture', segment: 'Furniture Stores', phone: '4372912', email: 'ayoubfurniture@hotmail.com', status: 'Interested', nextAction: 'Follow Up Later',
    _activities: [{ type: 'note', note: 'They will get back to us' }] },
  { company: 'Jmart Furniture and Carpets', segment: 'Furniture Stores', contact: 'Lamin Sonko', role: 'Sales', phone: '4370317', status: 'Interested', nextAction: 'Follow Up Later',
    _activities: [{ type: 'note', note: 'Will refer to the manager' }] },
  { company: 'Yonna', segment: 'Financial Services', contact: 'Fatou Cham', role: 'Head of Marketing', phone: '7538899', status: 'Follow Up', nextAction: 'Call Back',
    _activities: [{ type: 'note', note: 'Not now — will get back to us' }] },
  { company: 'Wave', segment: 'Financial Services', contact: 'Madabi Hydara', role: 'Staff', phone: '3018075', status: 'Follow Up', nextAction: 'Call Back',
    _activities: [{ type: 'note', note: 'Will get back to me' }] },
  { company: 'APS', segment: 'Financial Services', contact: 'Yusupha Suwareh', role: 'HR Officer', phone: '7082318', status: 'Follow Up', nextAction: 'Call Back',
    _activities: [{ type: 'note', note: 'Will put it into consideration' }] },
  { company: 'GBOS', segment: 'Government', email: 'gbosportal@gmail.com', phone: '4377847', status: 'Follow Up', nextAction: 'Call Back',
    _activities: [{ type: 'note', note: 'Promised to get back to me' }] },
  { company: 'SOS', segment: 'NGO', email: 'feedback.gambia@sosgambia.org', phone: '7215596', status: 'Follow Up', nextAction: 'Schedule Visit' },
  { company: 'Child Fund', segment: 'NGO', email: 'mmbye@childfund.org', status: 'Not Available', nextAction: 'Schedule Visit',
    _activities: [{ type: 'note', note: 'Will pay them a visit' }] },
  { company: 'IEC', segment: 'Government', email: 'iecgambia1996@gmail.com', phone: '4373804', status: 'Not Available', nextAction: 'Schedule Visit',
    _activities: [{ type: 'note', note: 'Will pay them a visit' }] },
  { company: 'Trust Bank', segment: 'Banks', phone: '7474447', status: 'Not Available', nextAction: 'Call Back' },
  { company: 'Spice Hub', segment: 'Restaurants', phone: '7185140', status: 'Not Available' },
  { company: 'Raslan Furniture Store', segment: 'Furniture Stores', phone: '7744443', status: 'Not Available' },
  { company: 'Kairaba Shopping Centre', segment: 'Supermarkets', status: 'New', nextAction: 'Schedule Visit',
    _activities: [{ type: 'visit', from: 'Kairaba Avenue', to: 'Kotu', cost: 72, outcome: 'Follow Up Needed', note: 'To introduce the company — will get back to us' }] },
  { company: 'Chicken Plaza', segment: 'Restaurants', status: 'New', nextAction: 'Schedule Visit' },

  // ---- Individuals from phone outreach (Leads + Call Log merged) ----
  { company: 'Brothers Car Rentals', segment: 'Car Rentals', contact: 'Modou', phone: '7627168', status: 'Interested', nextAction: 'Follow Up Later' },
  { company: 'Isaac Cars Sales & Rentals', segment: 'Car Rentals', contact: 'Isaac Touray', phone: '2853112', status: 'Interested', nextAction: 'Follow Up Later' },
  { company: 'Creation Plus', segment: 'Other', contact: 'Salif Kamaso', phone: '3909040', vehicles: '2', status: 'Contacted', nextAction: 'Send Proposal',
    _activities: [{ type: 'call', callStatus: 'Wants More info', note: 'Owns Creation Plus, 2 vehicles, wants to know more', nextAction: 'Send Proposal' }] },
  { company: 'Lalo Keita', segment: 'Car Rentals', contact: 'Lalo Keita', phone: '7870103', status: 'Interested', nextAction: 'Follow Up Later',
    _activities: [{ type: 'call', callStatus: 'Interested - Lead', note: 'Car dealer, expecting a 7-seater in ~3 weeks, will try', nextAction: 'Follow Up Later' }] },
  { company: 'Kebba Jawara', segment: 'Car Rentals', contact: 'Kebba Jawara', phone: '7477119', status: 'Interested', nextAction: 'Follow Up Later',
    _activities: [{ type: 'call', callStatus: 'Interested - Lead', note: 'Car dealer, aware of our service, will give it a try', nextAction: 'Follow Up Later' }] },
  { company: 'Muhammed Ceesay', segment: 'Private', contact: 'Muhammed Ceesay', phone: '7071414', status: 'Interested', nextAction: 'Follow Up Later',
    _activities: [{ type: 'call', callStatus: 'Interested - Lead', note: 'Abroad, saw advert on Facebook, would like to work with us', nextAction: 'Follow Up Later' }] },
  { company: 'Sheikh Faal', segment: 'Private', contact: 'Sheikh Faal', phone: '7944050', vehicles: '1', status: 'Contacted', nextAction: 'Call Back',
    _activities: [{ type: 'call', callStatus: 'Wants More info', note: 'Business owner, has a car, wants more info', nextAction: 'Call Back' }] },
  { company: 'Alhagie Jendu Ceesay', segment: 'Private', contact: 'Alhagie Jendu Ceesay', phone: '3464345', vehicles: '1', status: 'Interested', nextAction: 'Follow Up Later',
    _activities: [{ type: 'call', callStatus: 'Interested - Lead', note: 'Has a motorbike, will try and encourage his dad', nextAction: 'Follow Up Later' }] },
  { company: 'Patrick J Mendy', segment: 'Private', contact: 'Patrick J Mendy', phone: '3741270', status: 'Interested', nextAction: 'Schedule Visit',
    _activities: [{ type: 'call', callStatus: 'Interested - Lead', note: 'Interested, will visit the company to find out more', nextAction: 'Schedule Visit' }] },
]
