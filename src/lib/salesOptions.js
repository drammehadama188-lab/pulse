// Vocabularies from Sally's Excel "Reference Lists" sheet, unified into one
// customer funnel for the customer-centric model.

export const CUSTOMER_STATUS = ['New', 'Contacted', 'Interested', 'Follow Up', 'Proposal Sent', 'Demo Booked', 'Won', 'Lost', 'Not Available']
export const CALL_STATUS = ['No Answer', 'Not Right Now', 'Wants More info', 'Interested - Lead', 'Ask for call back', 'Not Interested', 'Visited', 'Wrong Number', 'Proposal Sent']
export const NEXT_ACTION = ['Call Back', 'Send Proposal', 'Schedule Visit', 'Demo App', 'Follow Up Later', 'Close']
export const TRANSPORT_OUTCOME = ['No Show', 'Interested', 'Lead Created', 'Sale Closed', 'Follow Up Needed']
export const VEHICLE_TYPES = ['Bike', 'Car', 'Truck', 'Tricycle']
export const SEGMENTS = [
  'Banks',
  'Financial Services',
  'Forex Bureau',
  'Pharmacies',
  'Supermarkets',
  'Restaurants',
  'Furniture Stores',
  'NGO',
  'Government',
  'Car Rentals',
  'Private',
  'Other',
]

export const STATUS_TONE = {
  New: 'neutral',
  Contacted: 'brand',
  Interested: 'brand',
  'Follow Up': 'warn',
  'Proposal Sent': 'rest',
  'Demo Booked': 'rest',
  Won: 'good',
  Lost: 'bad',
  'Not Available': 'neutral',
}

// pricing policy (from Sally's notice board)
export const PRICING = [
  { tier: 'Standard', vehicles: '1 vehicle', price: 7500, approval: false },
  { tier: 'Fleet discount', vehicles: '2–3 vehicles', price: 7000, approval: false },
  { tier: 'Fleet discount', vehicles: '5+ vehicles', price: 6500, approval: false },
  { tier: 'Special discount', vehicles: 'Any other discount', price: null, approval: true },
]

// daily activity targets (from the tracker)
export const DAILY_TARGETS = { calls: 20, leads: 3, sales: 1 }
