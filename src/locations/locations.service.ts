import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../redis/redis.service';
import axios from 'axios';

// Shape that matches what the frontend LocationService expects
export interface LocationResult {
  id: string;
  display_name: string;
  description: string;
  lat: number;
  lon: number;
  category: string;
}

@Injectable()
export class LocationsService {
  private readonly logger = new Logger(LocationsService.name);
  private readonly googleBaseUrl = 'https://maps.googleapis.com/maps/api';

  // Lagos bias coordinates and radius
  private readonly LAGOS_LAT = 6.5244;
  private readonly LAGOS_LNG = 3.3792;
  private readonly LAGOS_RADIUS = 50000; // 50km radius covers all of Lagos

  // Cache TTLs
  private readonly SEARCH_TTL = 86400;    // 24 hours for search results
  private readonly REVERSE_TTL = 604800;  // 7 days for reverse geocoding

  constructor(
    private config: ConfigService,
    private redis: RedisService,
  ) { }


  // ─── AUTOCOMPLETE SEARCH ──────────────────────────────────────────
  // Called when user types in the location search box
  // Returns top 8 matching Lagos locations

  async search(
    query: string,
    biasLat?: number,
    biasLng?: number,
  ): Promise<LocationResult[]> {
    if (!query || query.trim().length < 2) return [];

    const normalizedQuery = query.trim().toLowerCase();
    const biasKey = biasLat && biasLng
      ? `:${biasLat.toFixed(3)},${biasLng.toFixed(3)}`
      : '';
    const cacheKey = `location:search:${normalizedQuery}${biasKey}`;

    // 1. Check Redis cache first
    const cached = await this.redis.get<LocationResult[]>(cacheKey);
    if (cached) {
      this.logger.log(`Cache hit for search: "${query}"`);
      return cached;
    }

    // 2. Call Google Places Autocomplete API
    const apiKey = this.config.get<string>('GOOGLE_MAPS_API_KEY');

    try {
      const response = await axios.get(
        `${this.googleBaseUrl}/place/autocomplete/json`,
        {
          params: {
            input: query,
            key: apiKey,
            // Use pickup coords as bias if provided (category tap from destination field),
            // otherwise fall back to Lagos city center
            location: biasLat && biasLng
              ? `${biasLat},${biasLng}`
              : `${this.LAGOS_LAT},${this.LAGOS_LNG}`,
            radius: this.LAGOS_RADIUS,
            components: 'country:ng',
            types: 'geocode|establishment',
            language: 'en',
          },
        },
      );

      this.logger.log(`Google response status: ${response.data.status}`);
      this.logger.log(`Google error message: ${response.data.error_message}`);

      if (response.data.status !== 'OK' && response.data.status !== 'ZERO_RESULTS') {
        this.logger.error(`Google Places error: ${response.data.status} - ${response.data.error_message}`);
        return [];
      }

      // 3. Transform Google's response to our LocationResult shape
      const predictions = response.data.predictions.slice(0, 8);
      const results: LocationResult[] = await Promise.all(
        predictions.map(async (prediction: any) => {
          // Get lat/lng for each result via Place Details
          const coords = await this.getPlaceCoords(prediction.place_id, apiKey!);

          return {
            id: prediction.place_id,
            display_name: prediction.structured_formatting?.main_text ||
              prediction.description,
            description: prediction.structured_formatting?.secondary_text ||
              prediction.description,
            lat: coords.lat,
            lon: coords.lng,
            category: this.inferCategory(prediction.types),
          };
        }),
      );

      // 4. Cache results for 24 hours
      await this.redis.set(cacheKey, results, this.SEARCH_TTL);
      this.logger.log(`Cached ${results.length} results for: "${query}"`);

      return results;
    } catch (error: any) {
      this.logger.error(`Search failed for "${query}": ${error.message}`);
      return [];
    }
  }

  // ─── REVERSE GEOCODING ────────────────────────────────────────────
  // Converts GPS coordinates to a human-readable address
  // Called when driver arrives — records actual street address on trip

  async reverseGeocode(
    lat: number,
    lng: number,
  ): Promise<LocationResult> {
    const cacheKey = `location:reverse:${lat.toFixed(4)},${lng.toFixed(4)}`;

    // Check cache first
    const cached = await this.redis.get<LocationResult>(cacheKey);
    if (cached) {
      this.logger.log(`Cache hit for reverse geocode: ${lat},${lng}`);
      return cached;
    }

    const apiKey = this.config.get<string>('GOOGLE_MAPS_API_KEY');

    try {
      const response = await axios.get(
        `${this.googleBaseUrl}/geocode/json`,
        {
          params: {
            latlng: `${lat},${lng}`,
            key: apiKey,
            language: 'en',
            result_type: 'street_address|route|neighborhood|sublocality',
          },
        },
      );

      if (
        response.data.status !== 'OK' ||
        !response.data.results.length
      ) {
        // Fallback — return coordinates as display name
        return {
          id: `gps_${lat}_${lng}`,
          display_name: 'Current Location',
          description: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
          lat,
          lon: lng,
          category: 'Residential',
        };
      }

      const result = response.data.results[0];
      const components = result.address_components;

      // Extract meaningful parts of the address
      const streetNumber = this.getComponent(components, 'street_number');
      const route = this.getComponent(components, 'route');
      const neighborhood = this.getComponent(components, 'neighborhood') ||
        this.getComponent(components, 'sublocality_level_1');
      const city = this.getComponent(components, 'locality') || 'Lagos';

      const displayName = [streetNumber, route].filter(Boolean).join(' ') ||
        neighborhood ||
        result.formatted_address.split(',')[0];

      const description = [neighborhood, city]
        .filter(Boolean)
        .join(', ');

      const locationResult: LocationResult = {
        id: result.place_id,
        display_name: displayName,
        description,
        lat: result.geometry.location.lat,
        lon: result.geometry.location.lng,
        category: 'Residential',
      };

      // Cache for 7 days — addresses rarely change
      await this.redis.set(cacheKey, locationResult, this.REVERSE_TTL);

      return locationResult;
    } catch (error: any) {
      this.logger.error(`Reverse geocode failed: ${error.message}`);
      return {
        id: `gps_${lat}_${lng}`,
        display_name: 'Current Location',
        description: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
        lat,
        lon: lng,
        category: 'Residential',
      };
    }
  }

  // ─── PLACE DETAILS ────────────────────────────────────────────────
  // Gets lat/lng for a place_id from Google Places

  private async getPlaceCoords(
    placeId: string,
    apiKey: string,
  ): Promise<{ lat: number; lng: number }> {
    const cacheKey = `location:place:${placeId}`;

    const cached = await this.redis.get<{ lat: number; lng: number }>(cacheKey);
    if (cached) return cached;

    try {
      const response = await axios.get(
        `${this.googleBaseUrl}/place/details/json`,
        {
          params: {
            place_id: placeId,
            key: apiKey,
            fields: 'geometry',
          },
        },
      );

      const location = response.data.result?.geometry?.location;
      if (!location) return { lat: this.LAGOS_LAT, lng: this.LAGOS_LNG };

      const coords = { lat: location.lat, lng: location.lng };

      // Cache place coords for 30 days — they never change
      await this.redis.set(cacheKey, coords, 2592000);

      return coords;
    } catch {
      return { lat: this.LAGOS_LAT, lng: this.LAGOS_LNG };
    }
  }

  // ─── HELPERS ──────────────────────────────────────────────────────

  private getComponent(
    components: any[],
    type: string,
  ): string {
    const component = components.find((c) => c.types.includes(type));
    return component?.long_name || '';
  }

  private inferCategory(types: string[]): string {
    if (types.includes('airport')) return 'Airport';
    if (types.includes('lodging')) return 'Hotel';
    if (types.includes('shopping_mall')) return 'Shopping';
    if (types.includes('university') || types.includes('school'))
      return 'Education';
    if (types.includes('restaurant') || types.includes('food'))
      return 'Commercial';
    if (types.includes('transit_station') || types.includes('bus_station'))
      return 'Transport';
    if (types.includes('tourist_attraction')) return 'Tourism';
    if (types.includes('neighborhood') || types.includes('sublocality'))
      return 'District';
    return 'Residential';
  }

  // ─── ROUTE DETAILS ────────────────────────────────────────────────
  // Calls Google Distance Matrix API to get real road distance
  // and estimated travel time with current live traffic
  // This replaces the inaccurate Haversine formula

  async getRouteDetails(
    originLat: number,
    originLng: number,
    destLat: number,
    destLng: number,
  ): Promise<{
    distanceKm: number;
    estimatedMins: number;
    currentTrafficMins: number;
    fareEstimate: { low: number; high: number };
  }> {
    const cacheKey = `route:${originLat.toFixed(4)},${originLng.toFixed(4)}:${destLat.toFixed(4)},${destLng.toFixed(4)}`;

    // Cache route for 10 minutes — traffic changes frequently
    const cached = await this.redis.get<any>(cacheKey);
    if (cached) {
      this.logger.log(`Cache hit for route: ${cacheKey}`);
      return cached;
    }

    const apiKey = this.config.get<string>('GOOGLE_MAPS_API_KEY');

    try {
      const response = await axios.get(
        'https://maps.googleapis.com/maps/api/distancematrix/json',
        {
          params: {
            origins: `${originLat},${originLng}`,
            destinations: `${destLat},${destLng}`,
            mode: 'driving',
            departure_time: 'now',       // enables live traffic data
            traffic_model: 'best_guess', // most accurate traffic estimate
            key: apiKey,
          },
        },
      );

      const element = response.data.rows?.[0]?.elements?.[0];

      if (!element || element.status !== 'OK') {
        this.logger.error(`Distance Matrix error: ${element?.status}`);
        // Fall back to Haversine if Google fails
        return this.haversineFallback(originLat, originLng, destLat, destLng);
      }

      const distanceKm = element.distance.value / 1000;
      // duration = without traffic, duration_in_traffic = with live traffic
      const estimatedMins = Math.ceil(element.duration.value / 60);
      const currentTrafficMins = Math.ceil(
        (element.duration_in_traffic?.value ?? element.duration.value) / 60,
      );

      const fareEstimate = this.calculateFareRange(distanceKm, currentTrafficMins);

      const result = {
        distanceKm: Math.round(distanceKm * 10) / 10, // 1 decimal place
        estimatedMins,
        currentTrafficMins,
        fareEstimate,
      };

      // Cache for 10 minutes
      await this.redis.set(cacheKey, result, 600);
      this.logger.log(
        `Route: ${distanceKm.toFixed(1)}km, ${estimatedMins}mins base, ${currentTrafficMins}mins in traffic`,
      );

      return result;
    } catch (error: any) {
      this.logger.error(`Distance Matrix failed: ${error.message}`);
      return this.haversineFallback(originLat, originLng, destLat, destLng);
    }
  }

  // ─── FARE RANGE CALCULATOR ────────────────────────────────────────
  // Low  = distance only (no traffic surcharge)
  // High = distance + current traffic extra time

  private calculateFareRange(
    distanceKm: number,
    currentTrafficMins: number,
  ): { low: number; high: number } {
    const BASE_FARE = 500;
    const RATE_PER_KM = 100;
    const RATE_PER_MIN = 50;
    const SHORT_TRIP_FLAT = 2000;
    const SHORT_TRIP_KM = 4.5;

    if (distanceKm <= SHORT_TRIP_KM) {
      // Short trip — flat ₦2,000 base, surcharge only if traffic adds extra time
      // We use current traffic as estimate — if no extra time, just flat rate
      const low = SHORT_TRIP_FLAT;
      // High = flat + potential traffic surcharge
      // We don't know exact estimate yet (that's stored per trip)
      // So high = flat + (currentTrafficMins × 0.3 × RATE_PER_MIN) as rough upper bound
      const high = Math.round(
        (SHORT_TRIP_FLAT + currentTrafficMins * 0.3 * RATE_PER_MIN) / 50,
      ) * 50;
      return { low, high: Math.max(low, high) };
    }

    // Standard trip
    const baseFare = BASE_FARE + distanceKm * RATE_PER_KM;
    const low = Math.round(baseFare / 50) * 50;
    // High = base fare + extra time if current traffic is worse than base
    // Use currentTrafficMins as the worst case time component
    const high = Math.round(
      (baseFare + currentTrafficMins * RATE_PER_MIN) / 50,
    ) * 50;

    return { low, high };
  }

  // ─── HAVERSINE FALLBACK ───────────────────────────────────────────
  // Used when Google API fails — less accurate but never crashes

  private haversineFallback(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
  ): {
    distanceKm: number;
    estimatedMins: number;
    currentTrafficMins: number;
    fareEstimate: { low: number; high: number };
  } {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distanceKm = Math.round(R * c * 10) / 10;

    // Estimate time at 30km/h average Lagos speed
    const estimatedMins = Math.ceil((distanceKm / 30) * 60);
    const currentTrafficMins = Math.ceil(estimatedMins * 1.5); // 50% buffer

    return {
      distanceKm,
      estimatedMins,
      currentTrafficMins,
      fareEstimate: this.calculateFareRange(distanceKm, currentTrafficMins),
    };
  }
}