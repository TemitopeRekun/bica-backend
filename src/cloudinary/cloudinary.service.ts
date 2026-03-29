import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';

@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);
  private readonly cloudName: string;
  private readonly apiKey: string;
  private readonly apiSecret: string;

  constructor(private config: ConfigService) {
    this.cloudName = this.config.get<string>('CLOUDINARY_CLOUD_NAME')?.trim() ?? '';
    this.apiKey = this.config.get<string>('CLOUDINARY_API_KEY')?.trim() ?? '';
    this.apiSecret =
      this.config.get<string>('CLOUDINARY_API_SECRET')?.trim() ?? '';

    cloudinary.config({
      cloud_name: this.cloudName,
      api_key: this.apiKey,
      api_secret: this.apiSecret,
    });
  }

  /**
   * Uploads a base64 image string or a URL to Cloudinary.
   * @param base64OrUrl - base64 data URI (e.g. "data:image/jpeg;base64,...") or a URL
   * @param folder - Cloudinary folder to organise uploads (e.g. "bica/licenses")
   * @param publicId - optional unique ID for the asset
   */
  async uploadImage(
    base64OrUrl: string,
    folder: string,
    publicId?: string,
  ): Promise<string> {
    if (!base64OrUrl?.trim()) {
      throw new BadRequestException('Image payload is required');
    }

    this.ensureConfigured();

    try {
      const result = await cloudinary.uploader.upload(base64OrUrl, {
        folder,
        public_id: publicId,
        resource_type: 'image',
        quality: 'auto',
        fetch_format: 'auto',
        overwrite: true,
        invalidate: true,
      });
      this.logger.log(`Uploaded to Cloudinary: ${result.secure_url}`);
      return result.secure_url;
    } catch (error: any) {
      this.logger.error(`Cloudinary upload failed: ${error.message}`);
      throw new InternalServerErrorException('Image upload failed');
    }
  }

  async uploadBuffer(
    buffer: Buffer,
    folder: string,
    publicId?: string,
  ): Promise<string> {
    if (!buffer?.length) {
      throw new BadRequestException('Image file is required');
    }

    this.ensureConfigured();

    try {
      const result = await new Promise<any>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder,
            public_id: publicId,
            resource_type: 'image',
            quality: 'auto',
            fetch_format: 'auto',
            overwrite: true,
            invalidate: true,
          },
          (error, uploadResult) => {
            if (error || !uploadResult) {
              reject(error ?? new Error('Cloudinary upload failed'));
              return;
            }

            resolve(uploadResult);
          },
        );

        stream.end(buffer);
      });

      this.logger.log(`Uploaded to Cloudinary: ${result.secure_url}`);
      return result.secure_url;
    } catch (error: any) {
      this.logger.error(`Cloudinary upload failed: ${error.message}`);
      throw new InternalServerErrorException('Image upload failed');
    }
  }

  /**
   * Deletes an image from Cloudinary by its public_id.
   */
  async deleteImage(publicId: string): Promise<void> {
    try {
      await cloudinary.uploader.destroy(publicId);
      this.logger.log(`Deleted from Cloudinary: ${publicId}`);
    } catch (error: any) {
      this.logger.warn(`Could not delete image ${publicId}: ${error.message}`);
    }
  }

  private ensureConfigured() {
    if (this.cloudName && this.apiKey && this.apiSecret) {
      return;
    }

    throw new InternalServerErrorException(
      'Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.',
    );
  }
}
