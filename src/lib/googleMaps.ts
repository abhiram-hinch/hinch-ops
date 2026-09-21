/**
 * Loads the Google Maps JavaScript API once, however many components ask
 * for it. The key is bundled into the public frontend exactly like the
 * Supabase anon key already is — restrict it by HTTP referrer in Google
 * Cloud Console, don't treat it as a server secret.
 *
 * Deliberately not using the `&libraries=places` URL param + `loading=async`
 * combo: those two race in practice — the outer script's `onload` can fire
 * before Places has actually finished loading internally, so `new
 * google.maps.places.Autocomplete(...)` intermittently throws "Cannot read
 * properties of undefined (reading 'Autocomplete')" depending on timing.
 * `importLibrary()` is Google's own fix for exactly this — its promise is
 * the real signal that a library is ready, not the script tag's onload.
 */
let readyPromise: Promise<typeof google> | null = null;

export function loadGoogleMaps(): Promise<typeof google> {
  if (readyPromise) return readyPromise;

  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!key) {
    return Promise.reject(new Error("Google Maps isn't configured (missing VITE_GOOGLE_MAPS_API_KEY)."));
  }

  readyPromise = new Promise((resolve, reject) => {
    if (window.google?.maps?.importLibrary) {
      window.google.maps.importLibrary("places").then(() => resolve(window.google), reject);
      return;
    }

    const existing = document.getElementById("google-maps-script");
    const onBootstrapped = () =>
      window.google.maps.importLibrary("places").then(() => resolve(window.google), reject);

    if (existing) {
      existing.addEventListener("load", onBootstrapped);
      existing.addEventListener("error", () => reject(new Error("Failed to load Google Maps.")));
      return;
    }

    const script = document.createElement("script");
    script.id = "google-maps-script";
    script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&v=weekly`;
    script.async = true;
    script.onload = onBootstrapped;
    script.onerror = () => reject(new Error("Failed to load Google Maps."));
    document.head.appendChild(script);
  });

  return readyPromise;
}
