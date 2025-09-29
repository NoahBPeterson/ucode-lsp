/**
 * Socket module type definitions and function signatures
 * Based on ucode/lib/socket.c
 */

export interface SocketFunctionSignature {
  name: string;
  parameters: Array<{
    name: string;
    type: string;
    optional: boolean;
    defaultValue?: any;
  }>;
  returnType: string;
  description: string;
}

export interface SocketConstantSignature {
  name: string;
  value: string | number;
  type: string;
  description: string;
}

export const socketFunctions: Map<string, SocketFunctionSignature> = new Map([
  ["create", {
    name: "create",
    parameters: [
      { name: "domain", type: "number", optional: true, defaultValue: "AF_INET" },
      { name: "type", type: "number", optional: true, defaultValue: "SOCK_STREAM" },
      { name: "protocol", type: "number", optional: true, defaultValue: 0 }
    ],
    returnType: "socket | null",
    description: "Creates a network socket instance with the specified domain, type, and protocol."
  }],
  ["connect", {
    name: "connect",
    parameters: [
      { name: "host", type: "string | number[] | SocketAddress", optional: false },
      { name: "service", type: "string | number", optional: true },
      { name: "hints", type: "object", optional: true },
      { name: "timeout", type: "number", optional: true, defaultValue: -1 }
    ],
    returnType: "socket | null",
    description: "Creates a network socket and connects it to the specified host and service."
  }],
  ["listen", {
    name: "listen",
    parameters: [
      { name: "host", type: "string | number[] | SocketAddress", optional: true },
      { name: "service", type: "string | number", optional: true },
      { name: "hints", type: "object", optional: true },
      { name: "backlog", type: "number", optional: true, defaultValue: 128 },
      { name: "reuseaddr", type: "boolean", optional: true }
    ],
    returnType: "socket | null",
    description: "Binds a listening network socket to the specified host and service."
  }],
  ["sockaddr", {
    name: "sockaddr",
    parameters: [
      { name: "address", type: "string | number[] | SocketAddress", optional: false }
    ],
    returnType: "SocketAddress | null",
    description: "Parses the provided address value into a socket address representation."
  }],
  ["nameinfo", {
    name: "nameinfo",
    parameters: [
      { name: "address", type: "string | SocketAddress", optional: false },
      { name: "flags", type: "number", optional: true }
    ],
    returnType: "{hostname: string, service: string} | null",
    description: "Resolves the given network address into hostname and service name."
  }],
  ["addrinfo", {
    name: "addrinfo",
    parameters: [
      { name: "hostname", type: "string", optional: false },
      { name: "service", type: "string", optional: true },
      { name: "hints", type: "object", optional: true }
    ],
    returnType: "AddressInfo[] | null",
    description: "Resolves the given hostname and optional service name into a list of network addresses."
  }],
  ["poll", {
    name: "poll",
    parameters: [
      { name: "timeout", type: "number", optional: false },
      { name: "sockets", type: "socket | PollSpec", optional: false, variadic: true }
    ],
    returnType: "PollSpec[] | null",
    description: "Polls a number of sockets for state changes."
  }],
  ["error", {
    name: "error",
    parameters: [
      { name: "numeric", type: "boolean", optional: true }
    ],
    returnType: "string | number | null",
    description: "Query error information, returning either a description or numeric error code."
  }],
  ["strerror", {
    name: "strerror",
    parameters: [
      { name: "code", type: "number", optional: false }
    ],
    returnType: "string | null",
    description: "Returns a string containing a description of the error code."
  }]
]);

const PLATFORM_DEFINED_VALUE = 'platform-defined';
const LINUX_DEFINED_VALUE = 'platform-defined (Linux only)';

const buildConstant = (name: string, value: number | string, description: string): [string, SocketConstantSignature] => ([
  name,
  { name, value, type: 'number', description }
]);

const platformConstant = (name: string, description: string): [string, SocketConstantSignature] =>
  buildConstant(name, PLATFORM_DEFINED_VALUE, description);

const linuxConstant = (name: string, description: string): [string, SocketConstantSignature] =>
  buildConstant(name, LINUX_DEFINED_VALUE, description);

const socketConstantEntries: Array<[string, SocketConstantSignature]> = [
  // Address Families
  buildConstant("AF_UNSPEC", 0, "Unspecified address family"),
  buildConstant("AF_UNIX", 1, "UNIX domain sockets"),
  buildConstant("AF_INET", 2, "IPv4 Internet protocols"),
  buildConstant("AF_INET6", 10, "IPv6 Internet protocols"),
  buildConstant("AF_PACKET", 17, "Low-level packet interface (Linux only)"),

  // Socket Types
  buildConstant("SOCK_STREAM", 1, "Provides sequenced, reliable, two-way, connection-based byte streams"),
  buildConstant("SOCK_DGRAM", 2, "Supports datagrams (connectionless, unreliable messages)"),
  buildConstant("SOCK_RAW", 3, "Provides raw network protocol access"),
  buildConstant("SOCK_PACKET", 10, "Obsolete packet interface (Linux only)"),
  buildConstant("SOCK_NONBLOCK", 2048, "Enables non-blocking operation"),
  buildConstant("SOCK_CLOEXEC", 524288, "Sets the close-on-exec flag"),

  // Message Flags
  buildConstant("MSG_DONTROUTE", 4, "Send without using routing tables"),
  buildConstant("MSG_DONTWAIT", 64, "Enables non-blocking operation"),
  buildConstant("MSG_EOR", 128, "End of record"),
  buildConstant("MSG_NOSIGNAL", 16384, "Do not generate SIGPIPE"),
  buildConstant("MSG_OOB", 1, "Process out-of-band data"),
  buildConstant("MSG_PEEK", 2, "Peeks at incoming messages"),
  buildConstant("MSG_TRUNC", 32, "Report if datagram truncation occurred"),
  buildConstant("MSG_WAITALL", 256, "Wait for full message"),
  buildConstant("MSG_CONFIRM", 2048, "Confirm path validity (Linux only)"),
  buildConstant("MSG_MORE", 32768, "Sender will send more (Linux only)"),
  buildConstant("MSG_FASTOPEN", 536870912, "Send data in TCP SYN (Linux only)"),
  buildConstant("MSG_CMSG_CLOEXEC", 1073741824, "Sets close-on-exec flag on received file descriptor (Linux only)"),
  buildConstant("MSG_ERRQUEUE", 8192, "Receive errors from ICMP (Linux only)"),

  // Protocol Constants
  buildConstant("IPPROTO_IP", 0, "Dummy protocol for IP"),
  buildConstant("IPPROTO_IPV6", 41, "The IPv6 protocol"),
  buildConstant("IPPROTO_TCP", 6, "TCP protocol"),
  buildConstant("IPPROTO_UDP", 17, "UDP protocol"),

  // IPv4 Socket Options (IPPROTO_IP level)
  platformConstant("IP_ADD_MEMBERSHIP", "Add an IPv4 multicast group membership"),
  platformConstant("IP_ADD_SOURCE_MEMBERSHIP", "Add an IPv4 multicast group/source membership"),
  platformConstant("IP_BLOCK_SOURCE", "Block traffic from a multicast source"),
  platformConstant("IP_DROP_MEMBERSHIP", "Drop an IPv4 multicast group membership"),
  platformConstant("IP_DROP_SOURCE_MEMBERSHIP", "Drop an IPv4 multicast group/source membership"),
  platformConstant("IP_HDRINCL", "Outgoing packets include a user-supplied IP header"),
  platformConstant("IP_MSFILTER", "Configure multicast source filters"),
  platformConstant("IP_MULTICAST_IF", "Set the interface for outgoing multicast packets"),
  platformConstant("IP_MULTICAST_LOOP", "Control loopback of outgoing multicast packets"),
  platformConstant("IP_MULTICAST_TTL", "Set the TTL for outgoing multicast packets"),
  platformConstant("IP_OPTIONS", "Set or retrieve IPv4 options"),
  platformConstant("IP_PKTINFO", "Receive destination address and interface data"),
  platformConstant("IP_RECVOPTS", "Receive all IP options with incoming packets"),
  platformConstant("IP_RECVTOS", "Receive the IPv4 type of service field"),
  platformConstant("IP_RECVTTL", "Receive the IPv4 time-to-live value"),
  platformConstant("IP_RETOPTS", "Receive the IPv4 options actually used"),
  platformConstant("IP_TOS", "Set the IPv4 type-of-service field"),
  platformConstant("IP_TTL", "Set the default IPv4 time-to-live"),
  platformConstant("IP_UNBLOCK_SOURCE", "Unblock traffic from a multicast source"),
  linuxConstant("IP_BIND_ADDRESS_NO_PORT", "Allow binding without reserving a local port (Linux only)"),
  linuxConstant("IP_FREEBIND", "Allow binding to non-local IPv4 addresses (Linux only)"),
  linuxConstant("IP_MTU", "Retrieve or set the IPv4 path MTU (Linux only)"),
  linuxConstant("IP_MTU_DISCOVER", "Control IPv4 path MTU discovery (Linux only)"),
  linuxConstant("IP_MULTICAST_ALL", "Receive all multicast packets on the interface (Linux only)"),
  linuxConstant("IP_NODEFRAG", "Disable IPv4 fragmentation (Linux only)"),
  linuxConstant("IP_PASSSEC", "Receive IP security context information (Linux only)"),
  linuxConstant("IP_RECVERR", "Receive extended asynchronous error information (Linux only)"),
  linuxConstant("IP_RECVORIGDSTADDR", "Receive the original destination address (Linux only)"),
  linuxConstant("IP_ROUTER_ALERT", "Deliver packets with the router alert option (Linux only)"),
  linuxConstant("IP_TRANSPARENT", "Enable transparent proxying (Linux only)"),

  // IPv6 Socket Options (IPPROTO_IPV6 level)
  platformConstant("IPV6_FLOWINFO_SEND", "Control whether flow information is transmitted"),
  platformConstant("IPV6_FLOWINFO", "Receive flow label information with incoming packets"),
  platformConstant("IPV6_FLOWLABEL_MGR", "Manage IPv6 flow labels"),
  platformConstant("IPV6_MULTICAST_HOPS", "Set the hop limit for outgoing multicast packets"),
  platformConstant("IPV6_MULTICAST_IF", "Select the interface for outgoing multicast packets"),
  platformConstant("IPV6_MULTICAST_LOOP", "Control loopback of outgoing multicast packets"),
  platformConstant("IPV6_RECVTCLASS", "Receive the IPv6 traffic class field"),
  platformConstant("IPV6_TCLASS", "Set the IPv6 traffic class field"),
  platformConstant("IPV6_UNICAST_HOPS", "Set the default hop limit for unicast packets"),
  platformConstant("IPV6_V6ONLY", "Restrict the socket to IPv6 traffic only"),
  linuxConstant("IPV6_ADD_MEMBERSHIP", "Join an IPv6 multicast group (Linux only)"),
  linuxConstant("IPV6_ADDR_PREFERENCES", "Specify IPv6 address selection preferences (Linux only)"),
  linuxConstant("IPV6_ADDRFORM", "Convert an IPv6 socket to another address family (Linux only)"),
  linuxConstant("IPV6_AUTHHDR", "Receive IPv6 authentication headers (Linux only)"),
  linuxConstant("IPV6_AUTOFLOWLABEL", "Automatically manage IPv6 flow labels (Linux only)"),
  linuxConstant("IPV6_DONTFRAG", "Control IPv6 fragmentation behavior (Linux only)"),
  linuxConstant("IPV6_DROP_MEMBERSHIP", "Leave an IPv6 multicast group (Linux only)"),
  linuxConstant("IPV6_DSTOPTS", "Receive IPv6 destination options (Linux only)"),
  linuxConstant("IPV6_FREEBIND", "Allow binding to non-local IPv6 addresses (Linux only)"),
  linuxConstant("IPV6_HOPLIMIT", "Receive the IPv6 hop limit (Linux only)"),
  linuxConstant("IPV6_HOPOPTS", "Receive IPv6 hop-by-hop options (Linux only)"),
  linuxConstant("IPV6_JOIN_ANYCAST", "Join an IPv6 anycast group (Linux only)"),
  linuxConstant("IPV6_LEAVE_ANYCAST", "Leave an IPv6 anycast group (Linux only)"),
  linuxConstant("IPV6_MINHOPCOUNT", "Require a minimum IPv6 hop count (Linux only)"),
  linuxConstant("IPV6_MTU_DISCOVER", "Control IPv6 path MTU discovery (Linux only)"),
  linuxConstant("IPV6_MTU", "Retrieve or set the IPv6 path MTU (Linux only)"),
  linuxConstant("IPV6_MULTICAST_ALL", "Receive all IPv6 multicast packets (Linux only)"),
  linuxConstant("IPV6_PKTINFO", "Receive IPv6 packet information (Linux only)"),
  linuxConstant("IPV6_RECVDSTOPTS", "Receive IPv6 destination options control messages (Linux only)"),
  linuxConstant("IPV6_RECVERR", "Receive IPv6 asynchronous error information (Linux only)"),
  linuxConstant("IPV6_RECVFRAGSIZE", "Receive IPv6 fragment size information (Linux only)"),
  linuxConstant("IPV6_RECVHOPLIMIT", "Receive IPv6 hop limit information (Linux only)"),
  linuxConstant("IPV6_RECVHOPOPTS", "Receive IPv6 hop-by-hop options (Linux only)"),
  linuxConstant("IPV6_RECVORIGDSTADDR", "Receive the original IPv6 destination address (Linux only)"),
  linuxConstant("IPV6_RECVPATHMTU", "Receive IPv6 path MTU information (Linux only)"),
  linuxConstant("IPV6_RECVPKTINFO", "Receive IPv6 packet info control messages (Linux only)"),
  linuxConstant("IPV6_RECVRTHDR", "Receive IPv6 routing headers (Linux only)"),
  linuxConstant("IPV6_ROUTER_ALERT_ISOLATE", "Isolate IPv6 router alert traffic (Linux only)"),
  linuxConstant("IPV6_ROUTER_ALERT", "Receive packets with the IPv6 router alert option (Linux only)"),
  linuxConstant("IPV6_RTHDR", "Receive IPv6 routing headers control messages (Linux only)"),
  linuxConstant("IPV6_RTHDRDSTOPTS", "Receive IPv6 routing header destination options (Linux only)"),
  linuxConstant("IPV6_TRANSPARENT", "Enable IPv6 transparent proxying (Linux only)"),
  linuxConstant("IPV6_UNICAST_IF", "Select the interface for outgoing unicast packets (Linux only)"),

  // Socket Options (SOL_SOCKET level)
  buildConstant("SOL_SOCKET", 1, "Socket options at the socket API level"),
  buildConstant("SO_ACCEPTCONN", 30, "Reports whether socket listening is enabled"),
  buildConstant("SO_BROADCAST", 6, "Allow transmission of broadcast messages"),
  buildConstant("SO_DEBUG", 1, "Enable socket debugging"),
  buildConstant("SO_DONTROUTE", 5, "Send packets directly without routing"),
  buildConstant("SO_ERROR", 4, "Retrieves and clears the error status for the socket"),
  buildConstant("SO_KEEPALIVE", 9, "Enable keep-alive packets"),
  buildConstant("SO_LINGER", 13, "Set linger on close"),
  buildConstant("SO_OOBINLINE", 10, "Enables out-of-band data to be received in the normal data stream"),
  buildConstant("SO_RCVBUF", 8, "Set the receive buffer size"),
  buildConstant("SO_RCVLOWAT", 18, "Set the minimum number of bytes to process for input operations"),
  buildConstant("SO_RCVTIMEO", 20, "Set the timeout for receiving data"),
  buildConstant("SO_REUSEADDR", 2, "Allow the socket to be bound to an address that is already in use"),
  buildConstant("SO_REUSEPORT", 15, "Enable duplicate address and port bindings"),
  buildConstant("SO_SNDBUF", 7, "Set the send buffer size"),
  buildConstant("SO_SNDLOWAT", 19, "Set the minimum number of bytes to process for output operations"),
  buildConstant("SO_SNDTIMEO", 21, "Set the timeout for sending data"),
  buildConstant("SO_TIMESTAMP", 29, "Enable receiving of timestamps"),
  buildConstant("SO_TYPE", 3, "Retrieves the type of the socket"),
  linuxConstant("SO_ATTACH_BPF", "Attach a classic BPF program to the socket (Linux only)"),
  linuxConstant("SO_ATTACH_FILTER", "Attach a socket filter program (Linux only)"),
  linuxConstant("SO_ATTACH_REUSEPORT_CBPF", "Attach a classic BPF program for reuseport (Linux only)"),
  linuxConstant("SO_ATTACH_REUSEPORT_EBPF", "Attach an eBPF program for reuseport (Linux only)"),
  linuxConstant("SO_BINDTODEVICE", "Bind the socket to a specific network interface (Linux only)"),
  linuxConstant("SO_BUSY_POLL", "Enable busy polling for reduced latency (Linux only)"),
  linuxConstant("SO_DETACH_BPF", "Detach a classic BPF program from the socket (Linux only)"),
  linuxConstant("SO_DETACH_FILTER", "Detach a socket filter program (Linux only)"),
  linuxConstant("SO_DOMAIN", "Retrieve the socket's address family (Linux only)"),
  linuxConstant("SO_INCOMING_CPU", "Retrieve the CPU that handled the last packet (Linux only)"),
  linuxConstant("SO_INCOMING_NAPI_ID", "Retrieve the NAPI ID of the receiving interface (Linux only)"),
  linuxConstant("SO_LOCK_FILTER", "Lock the attached socket filter (Linux only)"),
  linuxConstant("SO_MARK", "Set the mark value for outgoing packets (Linux only)"),
  linuxConstant("SO_PASSCRED", "Receive SCM_CREDENTIALS control messages (Linux only)"),
  linuxConstant("SO_PASSSEC", "Receive security context information (Linux only)"),
  linuxConstant("SO_PEEK_OFF", "Peek data without removing it from the queue (Linux only)"),
  linuxConstant("SO_PEERCRED", "Retrieve peer credentials (Linux only)"),
  linuxConstant("SO_PEERSEC", "Retrieve peer security context (Linux only)"),
  linuxConstant("SO_PRIORITY", "Set the protocol-defined priority for packets (Linux only)"),
  linuxConstant("SO_PROTOCOL", "Retrieve the protocol number (Linux only)"),
  linuxConstant("SO_RCVBUFFORCE", "Force the receive buffer size (Linux only)"),
  linuxConstant("SO_RXQ_OVFL", "Report receive queue overflow events (Linux only)"),
  linuxConstant("SO_SNDBUFFORCE", "Force the send buffer size (Linux only)"),
  linuxConstant("SO_TIMESTAMPNS", "Enable nanosecond-resolution timestamps (Linux only)"),

  // Socket Credential Messages (Linux only in ucode build)
  linuxConstant("SCM_CREDENTIALS", "Pass process credentials in ancillary data (Linux only)"),
  linuxConstant("SCM_RIGHTS", "Pass file descriptors in ancillary data (Linux only)"),

  // TCP Socket Options (IPPROTO_TCP level)
  platformConstant("TCP_FASTOPEN", "Enable TCP Fast Open support"),
  platformConstant("TCP_KEEPCNT", "Configure the number of keepalive probes"),
  platformConstant("TCP_KEEPINTVL", "Configure the interval between keepalive probes"),
  platformConstant("TCP_MAXSEG", "Set the maximum TCP segment size"),
  platformConstant("TCP_NODELAY", "Disable Nagle's algorithm"),
  linuxConstant("TCP_CONGESTION", "Select the TCP congestion control algorithm (Linux only)"),
  linuxConstant("TCP_CORK", "Delay packet transmission until data is flushed (Linux only)"),
  linuxConstant("TCP_DEFER_ACCEPT", "Accept connections only when data arrives (Linux only)"),
  linuxConstant("TCP_FASTOPEN_CONNECT", "Enable client-side Fast Open (Linux only)"),
  linuxConstant("TCP_INFO", "Retrieve TCP connection state information (Linux only)"),
  linuxConstant("TCP_KEEPIDLE", "Set the idle time before keepalive probes (Linux only)"),
  linuxConstant("TCP_LINGER2", "Control linger in FIN_WAIT2 state (Linux only)"),
  linuxConstant("TCP_QUICKACK", "Enable quick acknowledgements (Linux only)"),
  linuxConstant("TCP_SYNCNT", "Limit SYN retransmissions (Linux only)"),
  linuxConstant("TCP_USER_TIMEOUT", "Set user-specified timeout for unacknowledged data (Linux only)"),
  linuxConstant("TCP_WINDOW_CLAMP", "Limit the advertised receive window (Linux only)"),

  // Packet Socket Constants (SOL_PACKET level, Linux only)
  linuxConstant("SOL_PACKET", "Socket options at the packet API level (Linux only)"),
  linuxConstant("PACKET_ADD_MEMBERSHIP", "Add a packet socket multicast membership (Linux only)"),
  linuxConstant("PACKET_DROP_MEMBERSHIP", "Drop a packet socket multicast membership (Linux only)"),
  linuxConstant("PACKET_AUXDATA", "Receive auxiliary packet data (Linux only)"),
  linuxConstant("PACKET_FANOUT", "Configure packet fanout across sockets (Linux only)"),
  linuxConstant("PACKET_LOSS", "Query packet loss statistics (Linux only)"),
  linuxConstant("PACKET_RESERVE", "Reserve space in packet socket buffers (Linux only)"),
  linuxConstant("PACKET_RX_RING", "Configure a packet socket receive ring (Linux only)"),
  linuxConstant("PACKET_STATISTICS", "Retrieve packet socket statistics (Linux only)"),
  linuxConstant("PACKET_TIMESTAMP", "Receive packet socket timestamps (Linux only)"),
  linuxConstant("PACKET_TX_RING", "Configure a packet socket transmit ring (Linux only)"),
  linuxConstant("PACKET_VERSION", "Select the packet socket protocol version (Linux only)"),
  linuxConstant("PACKET_QDISC_BYPASS", "Bypass queuing discipline for packet sockets (Linux only)"),
  linuxConstant("PACKET_MR_PROMISC", "Enable packet socket promiscuous mode (Linux only)"),
  linuxConstant("PACKET_MR_MULTICAST", "Enable packet socket multicast mode (Linux only)"),
  linuxConstant("PACKET_MR_ALLMULTI", "Receive all multicast packets (Linux only)"),
  linuxConstant("PACKET_HOST", "Receive packets destined for the host (Linux only)"),
  linuxConstant("PACKET_BROADCAST", "Receive broadcast packets (Linux only)"),
  linuxConstant("PACKET_MULTICAST", "Receive multicast packets (Linux only)"),
  linuxConstant("PACKET_OTHERHOST", "Receive packets destined for other hosts (Linux only)"),
  linuxConstant("PACKET_OUTGOING", "Mark outgoing packet socket traffic (Linux only)"),

  // UDP Socket Options (IPPROTO_UDP level)
  linuxConstant("UDP_CORK", "Cork UDP datagrams until uncorked (Linux only)"),

  // Shutdown Constants
  buildConstant("SHUT_RD", 0, "Disallow further receptions"),
  buildConstant("SHUT_WR", 1, "Disallow further transmissions"),
  buildConstant("SHUT_RDWR", 2, "Disallow further receptions and transmissions"),

  // Address Info Flags
  buildConstant("AI_ADDRCONFIG", 32, "Address configuration flag"),
  buildConstant("AI_ALL", 16, "Return IPv4 and IPv6 socket addresses"),
  buildConstant("AI_CANONIDN", 128, "Canonicalize using the IDNA standard"),
  buildConstant("AI_CANONNAME", 2, "Fill in the canonical name field"),
  buildConstant("AI_IDN", 64, "Enable IDN encoding"),
  buildConstant("AI_NUMERICHOST", 4, "Prevent hostname resolution"),
  buildConstant("AI_NUMERICSERV", 1024, "Prevent service name resolution"),
  buildConstant("AI_PASSIVE", 1, "Use passive socket"),
  buildConstant("AI_V4MAPPED", 8, "Map IPv6 addresses to IPv4-mapped format"),

  // Name Info Constants
  buildConstant("NI_DGRAM", 16, "Datagram socket type"),
  buildConstant("NI_IDN", 64, "Enable IDN encoding"),
  buildConstant("NI_MAXHOST", 1025, "Maximum hostname length"),
  buildConstant("NI_MAXSERV", 32, "Maximum service name length"),
  buildConstant("NI_NAMEREQD", 8, "Hostname resolution required"),
  buildConstant("NI_NOFQDN", 4, "Do not force fully qualified domain name"),
  buildConstant("NI_NUMERICHOST", 1, "Return numeric form of the hostname"),
  buildConstant("NI_NUMERICSERV", 2, "Return numeric form of the service name"),

  // Poll Event Constants
  buildConstant("POLLIN", 1, "Data available to read"),
  buildConstant("POLLPRI", 2, "Priority data available to read"),
  buildConstant("POLLOUT", 4, "Writable data available"),
  buildConstant("POLLERR", 8, "Error condition"),
  buildConstant("POLLHUP", 16, "Hang up"),
  buildConstant("POLLNVAL", 32, "Invalid request"),
  buildConstant("POLLRDHUP", 8192, "Peer closed or shutdown writing (Linux only)")
];

export const socketConstants: Map<string, SocketConstantSignature> = new Map(socketConstantEntries);

export class SocketTypeRegistry {
  getFunctionNames(): string[] {
    return Array.from(socketFunctions.keys());
  }

  getFunction(name: string): SocketFunctionSignature | undefined {
    return socketFunctions.get(name);
  }

  isSocketFunction(name: string): boolean {
    return socketFunctions.has(name);
  }

  formatFunctionSignature(name: string): string {
    const func = this.getFunction(name);
    if (!func) return '';
    
    const params = func.parameters.map(p => {
      if (p.optional && p.defaultValue !== undefined) {
        return `[${p.name}: ${p.type}] = ${p.defaultValue}`;
      } else if (p.optional) {
        return `[${p.name}: ${p.type}]`;
      } else {
        return `${p.name}: ${p.type}`;
      }
    }).join(', ');
    
    return `${name}(${params}): ${func.returnType}`;
  }

  getFunctionDocumentation(name: string): string {
    const func = this.getFunction(name);
    if (!func) return '';
    
    const signature = this.formatFunctionSignature(name);
    let doc = `**${signature}**\n\n${func.description}\n\n`;
    
    if (func.parameters.length > 0) {
      doc += '**Parameters:**\n';
      func.parameters.forEach(param => {
        const optional = param.optional ? ' (optional)' : '';
        const defaultVal = param.defaultValue !== undefined ? ` (default: ${param.defaultValue})` : '';
        doc += `- \`${param.name}\` (${param.type}${optional}${defaultVal})\n`;
      });
      doc += '\n';
    }
    
    doc += `**Returns:** \`${func.returnType}\``;
    return doc;
  }

  getConstantNames(): string[] {
    return Array.from(socketConstants.keys());
  }

  getConstant(name: string): SocketConstantSignature | undefined {
    return socketConstants.get(name);
  }

  isSocketConstant(name: string): boolean {
    return socketConstants.has(name);
  }

  getConstantDocumentation(name: string): string {
    const constant = this.getConstant(name);
    if (!constant) return '';
    
    return `**${constant.name}** = \`${constant.value}\`\n\n*${constant.type}*\n\n${constant.description}`;
  }

  isValidImport(name: string): boolean {
    return this.isSocketFunction(name) || this.isSocketConstant(name);
  }

  getValidImports(): string[] {
    return [...this.getFunctionNames(), ...this.getConstantNames()];
  }
}

export const socketTypeRegistry = new SocketTypeRegistry();
