import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
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
  constructor(private prisma: PrismaService) {}

  @WebSocketServer()
  server: Server;

  handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('driver:register')
  handleDriverRegister(
    @MessageBody() data: { driverId: string },
    @ConnectedSocket() client: Socket,
  ) {
    client.join(`user:${data.driverId}`);
    client.join('drivers'); // Also join a general drivers room for broadcasts
    console.log(`Driver ${data.driverId} joined room user:${data.driverId}`);
  }

  @SubscribeMessage('owner:register')
  handleOwnerRegister(
    @MessageBody() data: { ownerId: string },
    @ConnectedSocket() client: Socket,
  ) {
    client.join(`user:${data.ownerId}`);
    console.log(`Owner ${data.ownerId} joined room user:${data.ownerId}`);
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
    console.log(`Socket ${client.id} tracking driver ${data.driverId}`);
  }

  @SubscribeMessage('untrackdriver')
  handleUntrackDriver(
    @MessageBody() data: { driverId: string },
    @ConnectedSocket() client: Socket,
  ) {
    client.leave(`tracking:driver:${data.driverId}`);
    console.log(`Socket ${client.id} stopped tracking driver ${data.driverId}`);
  }

  // Notify driver of new ride request
  notifyDriverNewRide(driverId: string, trip: any) {
    this.server.to(`user:${driverId}`).emit('ride:assigned', trip);
    this.server.to(`user:${driverId}`).emit('ride:request', trip); // Redundant backup event
    console.log(`📡 [WS] Notification sent to Driver ${driverId}: ride:assigned & ride:request`);
  }

  notifyDriverAvailabilityChanged(
    driverId: string,
    isOnline: boolean,
    payload?: Record<string, unknown>,
  ) {
    const event = isOnline ? 'driver:online' : 'driver:offline';
    console.log(`Driver ${driverId} marked ${isOnline ? 'online' : 'offline'}`);

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
    // Note: Added driverId to payload for simplicity in Room logic, 
    // but usually you want to verify this via socket metadata or JWT.
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
        console.log(`📡 [WS] Sync-Burst 'ride:progress' [${milestoneMap[status]}] sent to Owner ${data.ownerId}`);
      }
    }
    
    // 2. Notify driver if present
    if (data.driverId) {
      this.server.to(`user:${data.driverId}`).emit('trip:status', payload);
    }
  }
}
