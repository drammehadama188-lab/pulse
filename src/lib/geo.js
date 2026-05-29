// Browser geolocation helper. Resolves null (never rejects) if unavailable/denied,
// so clock in/out always proceeds even without a location.
export function getLocation({ timeout = 6000 } = {}) {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: +pos.coords.latitude.toFixed(6), lng: +pos.coords.longitude.toFixed(6) }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout, maximumAge: 60000 },
    )
  })
}

export function mapsUrl(loc) {
  if (!loc || loc.lat == null) return null
  return `https://www.google.com/maps?q=${loc.lat},${loc.lng}`
}
