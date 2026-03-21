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
  ) {}

  // ─── AUTOCOMPLETE SEARCH ──────────────────────────────────────────
  // Called when user types in the location search box
  // Returns top 8 matching Lagos locations

  async search(query: string): Promise<LocationResult[]> {
    if (!query || query.trim().length < 2) return [];

    const normalizedQuery = query.trim().toLowerCase();
    const cacheKey = `location:search:${normalizedQuery}`;

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
            location: `${this.LAGOS_LAT},${this.LAGOS_LNG}`,
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
}