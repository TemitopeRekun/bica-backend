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

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/rides',
})
export class RidesGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  // Track which socket belongs to which driver
  private driverSockets = new Map<string, string>();

  handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    // Remove driver from tracking map on disconnect
    for (const [driverId, socketId] of this.driverSockets.entries()) {
      if (socketId === client.id) {
        this.driverSockets.delete(driverId);
        console.log(`Driver ${driverId} disconnected`);
        break;
      }
    }
  }

  // Driver registers their socket with their user ID
  @SubscribeMessage('driver:register')
  handleDriverRegister(
    @MessageBody() data: { driverId: string },
    @ConnectedSocket() client: Socket,
  ) {
    this.driverSockets.set(data.driverId, client.id);
    console.log(`Driver ${data.driverId} registered socket ${client.id}`);
  }

  // Driver sends location update
  // Broadcast to all clients watching this driver
  @SubscribeMessage('driver:location')
  handleLocationUpdate(
    @MessageBody() data: { driverId: string; lat: number; lng: number },
  ) {
    // Emit to everyone in the trip room
    this.server.to(`driver:${data.driverId}`).emit('location:updated', {
      driverId: data.driverId,
      lat: data.lat,
      lng: data.lng,
      timestamp: new Date().toISOString(),
    });
  }

  // Owner/rider joins a room to track a specific driver
  @SubscribeMessage('track:driver')
  handleTrackDriver(
    @MessageBody() data: { driverId: string },
    @ConnectedSocket() client: Socket,
  ) {
    client.join(`driver:${data.driverId}`);
    console.log(`Client ${client.id} tracking driver ${data.driverId}`);
  }

  // Called by RidesService when a trip is assigned
  // Notifies the driver they have a new ride
  notifyDriverNewRide(driverId: string, trip: any) {
    const socketId = this.driverSockets.get(driverId);
    if (socketId) {
      this.server.to(socketId).emit('ride:assigned', trip);
    }
  }
}