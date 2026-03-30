import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import { LocationsService } from './locations.service';

@Controller('locations')
export class LocationsController {
  constructor(private locationsService: LocationsService) {}

  // Public — no auth needed
  // Used on the search screen before and after login
  // GET /locations/search?q=Ikeja
  @Get('search')
  async search(
    @Query('q') query: string,
    @Query('biasLat') biasLat?: string,
    @Query('biasLng') biasLng?: string,
  ) {
    if (!query || query.trim().length < 2) {
      throw new BadRequestException(
        'Search query must be at least 2 characters',
      );
    }

    if ((biasLat && !biasLng) || (!biasLat && biasLng)) {
      throw new BadRequestException(
        'biasLat and biasLng must be provided together',
      );
    }

    const lat = this.parseOptionalCoordinate(biasLat, 'biasLat', -90, 90);
    const lng = this.parseOptionalCoordinate(biasLng, 'biasLng', -180, 180);

    return this.locationsService.search(query, lat, lng);
  }

  // Public — no auth needed
  // Used when driver sets location or trip records arrival address
  // GET /locations/reverse?lat=6.4549&lng=3.4246
  @Get('reverse')
  async reverseGeocode(@Query('lat') lat: string, @Query('lng') lng: string) {
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);

    if (isNaN(latNum) || isNaN(lngNum)) {
      throw new BadRequestException('lat and lng must be valid numbers');
    }

    if (latNum < -90 || latNum > 90 || lngNum < -180 || lngNum > 180) {
      throw new BadRequestException('Invalid coordinates');
    }

    return this.locationsService.reverseGeocode(latNum, lngNum);
  }

  // GET /locations/route?originLat=&originLng=&destLat=&destLng=
  // Called when owner selects both pickup and destination
  // Returns real road distance, estimated time, and fare range
  @Get('route')
  async getRoute(
    @Query('originLat') originLat: string,
    @Query('originLng') originLng: string,
    @Query('destLat') destLat: string,
    @Query('destLng') destLng: string,
  ) {
    const oLat = parseFloat(originLat);
    const oLng = parseFloat(originLng);
    const dLat = parseFloat(destLat);
    const dLng = parseFloat(destLng);

    if (isNaN(oLat) || isNaN(oLng) || isNaN(dLat) || isNaN(dLng)) {
      throw new BadRequestException('All coordinates must be valid numbers');
    }

    return this.locationsService.getRouteDetails(oLat, oLng, dLat, dLng);
  }

  private parseOptionalCoordinate(
    value: string | undefined,
    fieldName: string,
    min: number,
    max: number,
  ): number | undefined {
    if (value === undefined) return undefined;

    const parsed = parseFloat(value);
    if (!Number.isFinite(parsed)) {
      throw new BadRequestException(`${fieldName} must be a valid number`);
    }

    if (parsed < min || parsed > max) {
      throw new BadRequestException(
        `${fieldName} must be between ${min} and ${max}`,
      );
    }

    return parsed;
  }
}
