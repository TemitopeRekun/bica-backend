import {
  Controller,
  Get,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { LocationsService } from './locations.service';

@Controller('locations')
export class LocationsController {
  constructor(private locationsService: LocationsService) {}

  // Public — no auth needed
  // Used on the search screen before and after login
  // GET /locations/search?q=Ikeja
  @Get('search')
  async search(@Query('q') query: string) {
    if (!query || query.trim().length < 2) {
      throw new BadRequestException(
        'Search query must be at least 2 characters',
      );
    }
    return this.locationsService.search(query);
  }

  // Public — no auth needed
  // Used when driver sets location or trip records arrival address
  // GET /locations/reverse?lat=6.4549&lng=3.4246
  @Get('reverse')
  async reverseGeocode(
    @Query('lat') lat: string,
    @Query('lng') lng: string,
  ) {
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
}