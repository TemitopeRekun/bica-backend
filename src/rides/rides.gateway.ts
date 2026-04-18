import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';

@WebSocketGateway({
  cors: { 
    origin: (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:3001,http://localhost:5173,http://localhost:5174').split(',').map(o => o.trim()),
    credentials: true
  },
  namespace: '/rides',
})
export class RidesGateway
  implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RidesGateway.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  private verifySocketToken(client: Socket): { sub: string, role: string } | null {
    const token = client.handshake.auth?.token as string | undefined;
    if (!token) return null;
    try {
      return this.jwtService.verify<{ sub: string, role: string }>(token, {
        secret: process.env.JWT_SECRET,
      });
    } catch {
      return null;
    }
  }

  @WebSocketServer()
  server: Server;

  handleConnection(client: Socket) {
    this.logger.debug(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('driver:register')
  handleDriverRegister(
    @MessageBody() data: { driverId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const payload = this.verifySocketToken(client);
    if (payload !== null) {
      if (payload.role !== 'DRIVER') {
        this.logger.warn(`[WS] driver:register rejected — role is ${payload.role}, not DRIVER`);
        client.emit('error', { message: 'Unauthorized: driver role required' });
        return;
      }
      if (payload.sub !== data.driverId) {
        this.logger.warn(`[WS] driver:register rejected — token sub ${payload.sub} !== claimed ${data.driverId}`);
        client.emit('error', { message: 'Unauthorized: driverId mismatch' });
        return;
      }
    }
    client.join(`user:${data.driverId}`);
    client.join('drivers');
    this.logger.debug(`Driver ${data.driverId} joined room user:${data.driverId}`);
  }

  @SubscribeMessage('owner:register')
  handleOwnerRegister(
    @MessageBody() data: { ownerId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const payload = this.verifySocketToken(client);
    if (payload !== null && payload.sub !== data.ownerId) {
      this.logger.warn(`[WS] owner:register rejected — token sub ${payload.sub} !== claimed ${data.ownerId}`);
      client.emit('error', { message: 'Unauthorized: ownerId mismatch' });
      return;
    }
    client.join(`user:${data.ownerId}`);
    this.logger.debug(`Owner ${data.ownerId} joined room user:${data.ownerId}`);
  }

  @SubscribeMessage('driverlocation')
  handleLocationUpdate(
    @MessageBody() data: { driverId: string; lat: number; lng: number },
  ) {
    if (!Number.isFinite(data.lat) || !Number.isFinite(data.lng)) {
      return;
    }

    // Emit to anyone tracking this driver
    this.server.to(`tracking:driver:${data.driverId}`).emit('locationupdated', {
      driverId: data.driverId,
      lat: data.lat,
      lng: data.lng,
      timestamp: new Date().toISOString(),
    });
  }

  @SubscribeMessage('trackdriver')
  handleTrackDriver(
    @MessageBody() data: { driverId: string },
    @ConnectedSocket() client: Socket,
  ) {
    client.join(`tracking:driver:${data.driverId}`);
    this.logger.debug(`Socket ${client.id} tracking driver ${data.driverId}`);
  }

  @SubscribeMessage('untrackdriver')
  handleUntrackDriver(
    @MessageBody() data: { driverId: string },
    @ConnectedSocket() client: Socket,
  ) {
    client.leave(`tracking:driver:${data.driverId}`);
    this.logger.debug(`Socket ${client.id} stopped tracking driver ${data.driverId}`);
  }

  // Notify driver of new ride request
  notifyDriverNewRide(driverId: string, trip: any) {
    this.server.to(`user:${driverId}`).emit('ride:assigned', trip);
    this.server.to(`user:${driverId}`).emit('ride:request', trip);
    this.logger.debug(`[WS] Notified driver ${driverId}: ride:assigned & ride:request`);
  }

  notifyDriverAvailabilityChanged(
    driverId: string,
    isOnline: boolean,
    payload?: Record<string, unknown>,
  ) {
    const event = isOnline ? 'driver:online' : 'driver:offline';
    this.logger.debug(`Driver ${driverId} marked ${isOnline ? 'online' : 'offline'}`);

    // Notify the specific driver
    this.server.to(`user:${driverId}`).emit(event, {
      driverId,
      isOnline,
      timestamp: new Date().toISOString(),
      ...payload,
    });

    // Broadcast to all observers (e.g., admin dashboard or owners seeing online drivers)
    this.server.emit('driver:availability', {
      driverId,
      isOnline,
      timestamp: new Date().toISOString(),
      ...payload,
    });
  }

  // Notify owner that driver accepted
  notifyOwnerDriverAccepted(ownerId: string, data: any) {
    this.server.to(`user:${ownerId}`).emit('ride:accepted', data);
  }

  // Notify owner that driver declined
  notifyOwnerDriverDeclined(ownerId: string, data: any) {
    this.server.to(`user:${ownerId}`).emit('ride:declined', data);
  }

  // Notify owner that trip is complete and payment is needed
  notifyOwnerTripCompleted(ownerId: string, data: any) {
    this.server.to(`user:${ownerId}`).emit('trip:completed', data);
  }

  notifyOwnerPaymentUpdated(ownerId: string, data: any) {
    this.server.to(`user:${ownerId}`).emit('payment:updated', data);
  }

  notifyDriverPaymentUpdated(driverId: string, data: any) {
    this.server.to(`user:${driverId}`).emit('payment:updated', data);
  }

  // Notify owner of ride progress (milestones)
  notifyOwnerRideProgress(ownerId: string, data: {
    tripId: string;
    milestone: 'assigned' | 'arrived' | 'inprogress' | 'completed';
    timestamp: string;
    status?: string;
  }) {
    this.server.to(`user:${ownerId}`).emit('ride:progress', data);
  }

  @SubscribeMessage('driver:arrived')
  async handleDriverArrived(
    @MessageBody() data: { tripId: string; driverId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const payload = this.verifySocketToken(client);
    if (payload !== null && payload.sub !== data.driverId) {
      this.logger.warn(`[WS] driver:arrived rejected — token sub ${payload.sub} !== claimed ${data.driverId}`);
      client.emit('error', { message: 'Unauthorized: driverId mismatch' });
      return;
    }

    const trip = await this.prisma.trip.findUnique({
      where: { id: data.tripId },
      select: { ownerId: true, driverId: true },
    });

    if (trip && trip.driverId === data.driverId) {
      this.notifyOwnerRideProgress(trip.ownerId, {
        tripId: data.tripId,
        milestone: 'arrived',
        timestamp: new Date().toISOString(),
      });
    }
  }

  notifyOwnerTripStatus(ownerId: string, data: any) {
    this.server.to(`user:${ownerId}`).emit('trip:status', data);
  }

  notifyTripStatusChanged(tripId: string, status: string, data: any) {
    const payload = { tripId, status, ...data };
    
    // 1. Notify owner if present (Generic status)
    if (data.ownerId) {
      this.server.to(`user:${data.ownerId}`).emit('trip:status', payload);
      
      // 🛡️ Sync-Burst: Also send specific progress milestone for the timeline
      const milestoneMap: Record<string, any> = {
        'ASSIGNED': 'assigned',
        'ARRIVED': 'arrived',
        'IN_PROGRESS': 'inprogress',
        'COMPLETED': 'completed'
      };
      
      if (milestoneMap[status]) {
        this.notifyOwnerRideProgress(data.ownerId, {
          tripId,
          milestone: milestoneMap[status],
          timestamp: new Date().toISOString(),
          status
        });
        this.logger.debug(`[WS] Sync-Burst ride:progress [${milestoneMap[status]}] → Owner ${data.ownerId}`);
      }
    }
    
    // 2. Notify driver if present
    if (data.driverId) {
      this.server.to(`user:${data.driverId}`).emit('trip:status', payload);
    }
  }
}
