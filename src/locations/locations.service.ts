import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { RedisService } from '../redis/redis.service';
import { PrismaService } from '../prisma/prisma.service';
import { RidesService } from '../rides/rides.service';

export interface LocationResult {
  id: string;
  display_name: string;
  description: string;
  lat: number;
  lon: number;
  category: string;
  formatted_address?: string;
  street_number?: string | null;
  street?: string | null;
  area?: string | null;
  city?: string | null;
  lga?: string | null;
  state?: string | null;
  country?: string | null;
  place_types?: string[];
}

type GooglePlace = {
  place_id?: string;
  name?: string;
  formatted_address?: string;
  vicinity?: string;
  geometry?: {
    location?: {
      lat?: number;
      lng?: number;
    };
  };
  address_components?: Array<{
    long_name: string;
    short_name: string;
    types: string[];
  }>;
  types?: string[];
};

@Injectable()
export class LocationsService {
  private readonly logger = new Logger(LocationsService.name);
  private readonly googleBaseUrl = 'https://maps.googleapis.com/maps/api';
  private readonly SEARCH_TTL = 86400;
  private readonly REVERSE_TTL = 604800;
  private readonly PLACE_DETAILS_TTL = 2592000;
  private readonly CATEGORY_KEYWORDS = new Set([
    'airport',
    'airports',
    'hotel',
    'hotels',
    'hospital',
    'hospitals',
    'mall',
    'malls',
    'shopping mall',
    'shopping malls',
    'restaurant',
    'restaurants',
    'school',
    'schools',
    'university',
    'universities',
    'bus stop',
    'bus stops',
    'bus station',
    'bus stations',
  ]);

  constructor(
    private config: ConfigService,
    private redis: RedisService,
    private prisma: PrismaService,
    private ridesService: RidesService,
  ) {}

  async search(
    query: string,
    biasLat?: number,
    biasLng?: number,
  ): Promise<LocationResult[]> {
    if (!query || query.trim().length < 2) return [];

    const normalizedQuery = query.trim().toLowerCase();
    const hasBias = biasLat !== undefined && biasLng !== undefined;
    const biasKey = hasBias
      ? `:${biasLat.toFixed(3)},${biasLng.toFixed(3)}`
      : '';
    const cacheKey = `location:search:${normalizedQuery}${biasKey}`;

    const cached = await this.redis.get<LocationResult[]>(cacheKey);
    if (cached) {
      this.logger.log(`Cache hit for search: "${query}"`);
      return cached;
    }

    if (this.isCategorySearch(normalizedQuery)) {
      const nearbyResults = await this.searchNearbyCategory(
        query,
        normalizedQuery,
        biasLat,
        biasLng,
      );

      if (nearbyResults.length > 0) {
        await this.redis.set(cacheKey, nearbyResults, this.SEARCH_TTL);
        this.logger.log(
          `Cached ${nearbyResults.length} nearby results for: "${query}"`,
        );
        return nearbyResults;
      }
    }

    const apiKey = this.config.get<string>('GOOGLE_MAPS_API_KEY');
    if (!apiKey) {
      this.logger.error('GOOGLE_MAPS_API_KEY is not configured');
      return [];
    }

    try {
      const response = await axios.get(
        `${this.googleBaseUrl}/place/autocomplete/json`,
        {
          params: this.buildAutocompleteParams(query, apiKey, biasLat, biasLng),
        },
      );

      this.logger.log(`Google response status: ${response.data.status}`);
      if (response.data.error_message) {
        this.logger.warn(
          `Google error message: ${response.data.error_message}`,
        );
      }

      if (
        response.data.status !== 'OK' &&
        response.data.status !== 'ZERO_RESULTS'
      ) {
        this.logger.error(
          `Google Places error: ${response.data.status} - ${response.data.error_message}`,
        );
        return [];
      }

      const predictions = (response.data.predictions ?? []).slice(0, 8);
      const resolvedResults = await Promise.all(
        predictions.map(async (prediction: any) => {
          const place = await this.resolvePredictionLocation(
            prediction,
            apiKey,
          );

          if (place) {
            return this.toLocationResult(place, {
              fallbackDisplayName:
                prediction.structured_formatting?.main_text ||
                prediction.description,
              fallbackDescription:
                prediction.structured_formatting?.secondary_text ||
                prediction.description,
              fallbackCategory: this.inferCategory(prediction.types ?? []),
            });
          }

          this.logger.warn(
            `Skipping unresolved autocomplete prediction: ${prediction.place_id}`,
          );
          return null;
        }),
      );

      const results = resolvedResults.filter(
        (result): result is LocationResult => result !== null,
      );

      if (results.length > 0) {
        await this.redis.set(cacheKey, results, this.SEARCH_TTL);
        this.logger.log(`Cached ${results.length} results for: "${query}"`);
      }

      return results;
    } catch (error: any) {
      this.logger.error(`Search failed for "${query}": ${error.message}`);
      return [];
    }
  }

  async reverseGeocode(lat: number, lng: number): Promise<LocationResult> {
    const cacheKey = `location:reverse:${lat.toFixed(4)},${lng.toFixed(4)}`;
    const cached = await this.redis.get<LocationResult>(cacheKey);

    if (cached) {
      this.logger.log(`Cache hit for reverse geocode: ${lat},${lng}`);
      return cached;
    }

    const apiKey = this.config.get<string>('GOOGLE_MAPS_API_KEY');
    if (!apiKey) {
      this.logger.error('GOOGLE_MAPS_API_KEY is not configured');
      return this.buildFallbackLocation(lat, lng);
    }

    try {
      const response = await axios.get(`${this.googleBaseUrl}/geocode/json`, {
        params: {
          latlng: `${lat},${lng}`,
          key: apiKey,
          language: 'en',
        },
      });

      const place = response.data.results?.[0];
      if (response.data.status !== 'OK' || !this.hasGeometryLocation(place)) {
        return this.buildFallbackLocation(lat, lng);
      }

      const result = this.toLocationResult(place, {
        fallbackDisplayName: 'Current Location',
        fallbackDescription: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
        fallbackCategory: 'Residential',
      });

      await this.redis.set(cacheKey, result, this.REVERSE_TTL);
      return result;
    } catch (error: any) {
      this.logger.error(`Reverse geocode failed: ${error.message}`);
      return this.buildFallbackLocation(lat, lng);
    }
  }

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
    const cached = await this.redis.get<any>(cacheKey);

    if (cached) {
      this.logger.log(`Cache hit for route: ${cacheKey}`);
      return cached;
    }

    const apiKey = this.config.get<string>('GOOGLE_MAPS_API_KEY');
    if (!apiKey) {
      this.logger.error('GOOGLE_MAPS_API_KEY is not configured');
      return this.haversineFallback(originLat, originLng, destLat, destLng);
    }

    try {
      const response = await axios.get(
        'https://maps.googleapis.com/maps/api/distancematrix/json',
        {
          params: {
            origins: `${originLat},${originLng}`,
            destinations: `${destLat},${destLng}`,
            mode: 'driving',
            departure_time: 'now',
            traffic_model: 'best_guess',
            key: apiKey,
          },
        },
      );

      const element = response.data.rows?.[0]?.elements?.[0];
      if (!element || element.status !== 'OK') {
        this.logger.error(`Distance Matrix error: ${element?.status}`);
        return this.haversineFallback(originLat, originLng, destLat, destLng);
      }

      const distanceKm = element.distance.value / 1000;
      const estimatedMins = Math.ceil(element.duration.value / 60);
      const currentTrafficMins = Math.ceil(
        (element.duration_in_traffic?.value ?? element.duration.value) / 60,
      );

      const result = {
        distanceKm: Math.round(distanceKm * 10) / 10,
        estimatedMins,
        currentTrafficMins,
        fareEstimate: await this.calculateFareRange(
          distanceKm,
          estimatedMins,
          currentTrafficMins,
        ),
      };

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

  private async getPlaceDetails(
    placeId: string,
    apiKey: string,
  ): Promise<GooglePlace | null> {
    const cacheKey = `location:place:${placeId}`;
    const cached = await this.redis.get<GooglePlace>(cacheKey);

    if (cached) return cached;

    try {
      const response = await axios.get(
        `${this.googleBaseUrl}/place/details/json`,
        {
          params: {
            place_id: placeId,
            key: apiKey,
            fields:
              'place_id,name,formatted_address,geometry,address_component,type',
          },
        },
      );

      const place = response.data.result;
      if (!this.hasGeometryLocation(place)) return null;

      await this.redis.set(cacheKey, place, this.PLACE_DETAILS_TTL);
      return place;
    } catch (error: any) {
      this.logger.warn(
        `Place details lookup failed for ${placeId}: ${error.message}`,
      );
      return null;
    }
  }

  private async geocodePlaceId(
    placeId: string,
    apiKey: string,
  ): Promise<GooglePlace | null> {
    const cacheKey = `location:place:geocode:${placeId}`;
    const cached = await this.redis.get<GooglePlace>(cacheKey);

    if (cached) return cached;

    try {
      const response = await axios.get(`${this.googleBaseUrl}/geocode/json`, {
        params: {
          place_id: placeId,
          key: apiKey,
          language: 'en',
        },
      });

      const place = response.data.results?.[0];
      if (!this.hasGeometryLocation(place)) return null;

      await this.redis.set(cacheKey, place, this.PLACE_DETAILS_TTL);
      return place;
    } catch (error: any) {
      this.logger.warn(
        `Geocode fallback failed for ${placeId}: ${error.message}`,
      );
      return null;
    }
  }

  private isCategorySearch(query: string): boolean {
    return this.CATEGORY_KEYWORDS.has(query);
  }

  private async searchNearbyCategory(
    query: string,
    normalizedQuery: string,
    biasLat?: number,
    biasLng?: number,
  ): Promise<LocationResult[]> {
    const apiKey = this.config.get<string>('GOOGLE_MAPS_API_KEY');
    const hasBias = biasLat !== undefined && biasLng !== undefined;
    if (!apiKey) {
      this.logger.error('GOOGLE_MAPS_API_KEY is not configured');
      return [];
    }

    try {
      const response = await axios.get(
        `${this.googleBaseUrl}/place/textsearch/json`,
        {
          params: {
            query,
            key: apiKey,
            language: 'en',
            region: 'ng',
            ...(hasBias
              ? {
                  location: `${biasLat},${biasLng}`,
                  radius: 5000,
                }
              : {}),
          },
        },
      );

      this.logger.log(`Google nearby category status: ${response.data.status}`);
      if (
        response.data.status !== 'OK' &&
        response.data.status !== 'ZERO_RESULTS'
      ) {
        this.logger.error(
          `Google nearby category error for "${normalizedQuery}": ${response.data.status} - ${response.data.error_message}`,
        );
        return [];
      }

      const detailedResults = await Promise.all(
        (response.data.results ?? []).slice(0, 8).map(async (result: any) => {
          const placeDetails = result.place_id
            ? await this.getPlaceDetails(result.place_id, apiKey)
            : null;
          const resolvedPlace = placeDetails ?? result;
          if (!this.hasGeometryLocation(resolvedPlace)) {
            this.logger.warn(
              `Skipping nearby category result without geometry: ${result.place_id ?? result.name}`,
            );
            return null;
          }

          const parsedResult = this.toLocationResult(resolvedPlace, {
            fallbackDisplayName: result.name,
            fallbackDescription:
              result.formatted_address ?? result.vicinity ?? result.name,
            fallbackCategory: this.inferCategory(result.types ?? []),
          });

          if (hasBias) {
            return {
              ...parsedResult,
              __distanceKm: this.calculateStraightLineDistanceKm(
                biasLat!,
                biasLng!,
                parsedResult.lat,
                parsedResult.lon,
              ),
            };
          }

          return parsedResult;
        }),
      );

      return detailedResults
        .filter(
          (result): result is LocationResult & { __distanceKm?: number } =>
            result !== null,
        )
        .sort((a: any, b: any) => (a.__distanceKm ?? 0) - (b.__distanceKm ?? 0))
        .map(({ __distanceKm, ...result }: any) => result);
    } catch (error: any) {
      this.logger.error(
        `Nearby category search failed for "${query}": ${error.message}`,
      );
      return [];
    }
  }

  private toLocationResult(
    place: GooglePlace,
    fallback?: {
      fallbackDisplayName?: string;
      fallbackDescription?: string;
      fallbackCategory?: string;
    },
  ): LocationResult {
    const components = place.address_components ?? [];
    const streetNumber = this.getComponent(components, 'street_number') || null;
    const street = this.getComponent(components, 'route') || null;
    const area =
      this.getComponent(components, 'neighborhood') ||
      this.getComponent(components, 'sublocality_level_1') ||
      this.getComponent(components, 'sublocality') ||
      null;
    const city =
      this.getComponent(components, 'locality') ||
      this.getComponent(components, 'postal_town') ||
      null;
    const lga =
      this.getComponent(components, 'administrative_area_level_2') || null;
    const state =
      this.getComponent(components, 'administrative_area_level_1') || null;
    const country = this.getComponent(components, 'country') || null;
    const formattedAddress =
      place.formatted_address ??
      fallback?.fallbackDescription ??
      [streetNumber, street, area, city || lga, state]
        .filter(Boolean)
        .join(', ');
    const displayName =
      [streetNumber, street].filter(Boolean).join(' ') ||
      place.name ||
      area ||
      fallback?.fallbackDisplayName ||
      formattedAddress ||
      'Selected Location';
    const description =
      [area, city || lga, state].filter(Boolean).join(', ') ||
      fallback?.fallbackDescription ||
      formattedAddress ||
      displayName;
    const placeTypes = place.types ?? [];

    return {
      id: place.place_id ?? displayName,
      display_name: displayName,
      description,
      lat: place.geometry!.location!.lat!,
      lon: place.geometry!.location!.lng!,
      category: fallback?.fallbackCategory ?? this.inferCategory(placeTypes),
      formatted_address: formattedAddress || undefined,
      street_number: streetNumber,
      street,
      area,
      city,
      lga,
      state,
      country,
      place_types: placeTypes,
    };
  }

  private buildFallbackLocation(lat: number, lng: number): LocationResult {
    return {
      id: `gps_${lat}_${lng}`,
      display_name: 'Current Location',
      description: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
      lat,
      lon: lng,
      category: 'Residential',
      formatted_address: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
      street_number: null,
      street: null,
      area: null,
      city: null,
      lga: null,
      state: null,
      country: null,
      place_types: [],
    };
  }

  private getComponent(
    components: Array<{ long_name: string; types: string[] }>,
    type: string,
  ): string {
    const component = components.find((c) => c.types.includes(type));
    return component?.long_name || '';
  }

  private buildAutocompleteParams(
    query: string,
    apiKey: string,
    biasLat?: number,
    biasLng?: number,
  ) {
    const hasBias = biasLat !== undefined && biasLng !== undefined;

    return {
      input: query,
      key: apiKey,
      components: 'country:ng',
      language: 'en',
      region: 'ng',
      ...(hasBias
        ? {
            locationbias: `circle:5000@${biasLat},${biasLng}`,
            origin: `${biasLat},${biasLng}`,
          }
        : {}),
    };
  }

  private async resolvePredictionLocation(
    prediction: { place_id?: string },
    apiKey: string,
  ): Promise<GooglePlace | null> {
    if (!prediction.place_id) return null;

    const placeDetails = await this.getPlaceDetails(
      prediction.place_id,
      apiKey,
    );
    if (this.hasGeometryLocation(placeDetails)) {
      return placeDetails;
    }

    return this.geocodePlaceId(prediction.place_id, apiKey);
  }

  private hasGeometryLocation(
    place: GooglePlace | null | undefined,
  ): place is GooglePlace & {
    geometry: { location: { lat: number; lng: number } };
  } {
    return (
      place !== null &&
      place !== undefined &&
      typeof place.geometry?.location?.lat === 'number' &&
      typeof place.geometry?.location?.lng === 'number'
    );
  }

  private inferCategory(types: string[]): string {
    if (types.includes('airport')) return 'Airport';
    if (types.includes('lodging')) return 'Hotel';
    if (types.includes('shopping_mall')) return 'Shopping';
    if (types.includes('university') || types.includes('school')) {
      return 'Education';
    }
    if (types.includes('restaurant') || types.includes('food')) {
      return 'Commercial';
    }
    if (types.includes('transit_station') || types.includes('bus_station')) {
      return 'Transport';
    }
    if (types.includes('tourist_attraction')) return 'Tourism';
    if (types.includes('neighborhood') || types.includes('sublocality')) {
      return 'District';
    }
    return 'Residential';
  }

  private async calculateFareRange(
    distanceKm: number,
    estimatedMins: number,
    currentTrafficMins: number,
  ): Promise<{ low: number; high: number }> {
    const settings = await this.prisma.systemSettings.findFirst();
    if (!settings) {
      // Emergency fallbacks if DB settings missing
      return { low: 2000, high: 2000 };
    }

    const lowEstimate = this.ridesService.calculateTripFare(distanceKm, estimatedMins, settings as any);
    const highEstimate = this.ridesService.calculateTripFare(distanceKm, currentTrafficMins, settings as any);

    return { 
      low: lowEstimate.finalFare, 
      high: Math.max(lowEstimate.finalFare, highEstimate.finalFare) 
    };
  }

  private async haversineFallback(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
  ): Promise<{
    distanceKm: number;
    estimatedMins: number;
    currentTrafficMins: number;
    fareEstimate: { low: number; high: number };
  }> {
    const distanceKm = this.calculateStraightLineDistanceKm(
      lat1,
      lng1,
      lat2,
      lng2,
    );
    const roundedDistanceKm = Math.round(distanceKm * 10) / 10;
    const estimatedMins = Math.ceil((roundedDistanceKm / 30) * 60);
    const currentTrafficMins = Math.ceil(estimatedMins * 1.5);

    return {
      distanceKm: roundedDistanceKm,
      estimatedMins,
      currentTrafficMins,
      fareEstimate: await this.calculateFareRange(
        roundedDistanceKm,
        estimatedMins,
        currentTrafficMins,
      ),
    };
  }

  private calculateStraightLineDistanceKm(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
  ): number {
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

    return R * c;
  }
}
