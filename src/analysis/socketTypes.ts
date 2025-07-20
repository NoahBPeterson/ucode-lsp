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

export const socketConstants: Map<string, SocketConstantSignature> = new Map([
  // Address Families
  ["AF_UNSPEC", { name: "AF_UNSPEC", value: 0, type: "number", description: "Unspecified address family" }],
  ["AF_UNIX", { name: "AF_UNIX", value: 1, type: "number", description: "UNIX domain sockets" }],
  ["AF_INET", { name: "AF_INET", value: 2, type: "number", description: "IPv4 Internet protocols" }],
  ["AF_INET6", { name: "AF_INET6", value: 10, type: "number", description: "IPv6 Internet protocols" }],
  ["AF_PACKET", { name: "AF_PACKET", value: 17, type: "number", description: "Low-level packet interface (Linux only)" }],

  // Socket Types
  ["SOCK_STREAM", { name: "SOCK_STREAM", value: 1, type: "number", description: "Provides sequenced, reliable, two-way, connection-based byte streams" }],
  ["SOCK_DGRAM", { name: "SOCK_DGRAM", value: 2, type: "number", description: "Supports datagrams (connectionless, unreliable messages)" }],
  ["SOCK_RAW", { name: "SOCK_RAW", value: 3, type: "number", description: "Provides raw network protocol access" }],
  ["SOCK_PACKET", { name: "SOCK_PACKET", value: 10, type: "number", description: "Obsolete packet interface (Linux only)" }],
  ["SOCK_NONBLOCK", { name: "SOCK_NONBLOCK", value: 2048, type: "number", description: "Enables non-blocking operation" }],
  ["SOCK_CLOEXEC", { name: "SOCK_CLOEXEC", value: 524288, type: "number", description: "Sets the close-on-exec flag" }],

  // Message Flags
  ["MSG_DONTROUTE", { name: "MSG_DONTROUTE", value: 4, type: "number", description: "Send without using routing tables" }],
  ["MSG_DONTWAIT", { name: "MSG_DONTWAIT", value: 64, type: "number", description: "Enables non-blocking operation" }],
  ["MSG_EOR", { name: "MSG_EOR", value: 128, type: "number", description: "End of record" }],
  ["MSG_NOSIGNAL", { name: "MSG_NOSIGNAL", value: 16384, type: "number", description: "Do not generate SIGPIPE" }],
  ["MSG_OOB", { name: "MSG_OOB", value: 1, type: "number", description: "Process out-of-band data" }],
  ["MSG_PEEK", { name: "MSG_PEEK", value: 2, type: "number", description: "Peeks at incoming messages" }],
  ["MSG_TRUNC", { name: "MSG_TRUNC", value: 32, type: "number", description: "Report if datagram truncation occurred" }],
  ["MSG_WAITALL", { name: "MSG_WAITALL", value: 256, type: "number", description: "Wait for full message" }],
  ["MSG_CONFIRM", { name: "MSG_CONFIRM", value: 2048, type: "number", description: "Confirm path validity (Linux only)" }],
  ["MSG_MORE", { name: "MSG_MORE", value: 32768, type: "number", description: "Sender will send more (Linux only)" }],
  ["MSG_FASTOPEN", { name: "MSG_FASTOPEN", value: 536870912, type: "number", description: "Send data in TCP SYN (Linux only)" }],
  ["MSG_CMSG_CLOEXEC", { name: "MSG_CMSG_CLOEXEC", value: 1073741824, type: "number", description: "Sets close-on-exec flag on received file descriptor (Linux only)" }],
  ["MSG_ERRQUEUE", { name: "MSG_ERRQUEUE", value: 8192, type: "number", description: "Receive errors from ICMP (Linux only)" }],

  // Socket Option Constants
  ["SOL_SOCKET", { name: "SOL_SOCKET", value: 1, type: "number", description: "Socket options at the socket API level" }],
  ["SO_ACCEPTCONN", { name: "SO_ACCEPTCONN", value: 30, type: "number", description: "Reports whether socket listening is enabled" }],
  ["SO_BROADCAST", { name: "SO_BROADCAST", value: 6, type: "number", description: "Allow transmission of broadcast messages" }],
  ["SO_DEBUG", { name: "SO_DEBUG", value: 1, type: "number", description: "Enable socket debugging" }],
  ["SO_DONTROUTE", { name: "SO_DONTROUTE", value: 5, type: "number", description: "Send packets directly without routing" }],
  ["SO_ERROR", { name: "SO_ERROR", value: 4, type: "number", description: "Retrieves and clears the error status for the socket" }],
  ["SO_KEEPALIVE", { name: "SO_KEEPALIVE", value: 9, type: "number", description: "Enable keep-alive packets" }],
  ["SO_LINGER", { name: "SO_LINGER", value: 13, type: "number", description: "Set linger on close" }],
  ["SO_OOBINLINE", { name: "SO_OOBINLINE", value: 10, type: "number", description: "Enables out-of-band data to be received in the normal data stream" }],
  ["SO_RCVBUF", { name: "SO_RCVBUF", value: 8, type: "number", description: "Set the receive buffer size" }],
  ["SO_RCVLOWAT", { name: "SO_RCVLOWAT", value: 18, type: "number", description: "Set the minimum number of bytes to process for input operations" }],
  ["SO_RCVTIMEO", { name: "SO_RCVTIMEO", value: 20, type: "number", description: "Set the timeout for receiving data" }],
  ["SO_REUSEADDR", { name: "SO_REUSEADDR", value: 2, type: "number", description: "Allow the socket to be bound to an address that is already in use" }],
  ["SO_REUSEPORT", { name: "SO_REUSEPORT", value: 15, type: "number", description: "Enable duplicate address and port bindings" }],
  ["SO_SNDBUF", { name: "SO_SNDBUF", value: 7, type: "number", description: "Set the send buffer size" }],
  ["SO_SNDLOWAT", { name: "SO_SNDLOWAT", value: 19, type: "number", description: "Set the minimum number of bytes to process for output operations" }],
  ["SO_SNDTIMEO", { name: "SO_SNDTIMEO", value: 21, type: "number", description: "Set the timeout for sending data" }],
  ["SO_TIMESTAMP", { name: "SO_TIMESTAMP", value: 29, type: "number", description: "Enable receiving of timestamps" }],
  ["SO_TYPE", { name: "SO_TYPE", value: 3, type: "number", description: "Retrieves the type of the socket" }],

  // Protocol Constants
  ["IPPROTO_IP", { name: "IPPROTO_IP", value: 0, type: "number", description: "Dummy protocol for IP" }],
  ["IPPROTO_IPV6", { name: "IPPROTO_IPV6", value: 41, type: "number", description: "The IPv6 protocol" }],
  ["IPPROTO_TCP", { name: "IPPROTO_TCP", value: 6, type: "number", description: "TCP protocol" }],
  ["IPPROTO_UDP", { name: "IPPROTO_UDP", value: 17, type: "number", description: "UDP protocol" }],

  // Shutdown Constants
  ["SHUT_RD", { name: "SHUT_RD", value: 0, type: "number", description: "Disallow further receptions" }],
  ["SHUT_WR", { name: "SHUT_WR", value: 1, type: "number", description: "Disallow further transmissions" }],
  ["SHUT_RDWR", { name: "SHUT_RDWR", value: 2, type: "number", description: "Disallow further receptions and transmissions" }],

  // Address Info Flags
  ["AI_ADDRCONFIG", { name: "AI_ADDRCONFIG", value: 32, type: "number", description: "Address configuration flag" }],
  ["AI_ALL", { name: "AI_ALL", value: 16, type: "number", description: "Return IPv4 and IPv6 socket addresses" }],
  ["AI_CANONIDN", { name: "AI_CANONIDN", value: 128, type: "number", description: "Canonicalize using the IDNA standard" }],
  ["AI_CANONNAME", { name: "AI_CANONNAME", value: 2, type: "number", description: "Fill in the canonical name field" }],
  ["AI_IDN", { name: "AI_IDN", value: 64, type: "number", description: "Enable IDN encoding" }],
  ["AI_NUMERICHOST", { name: "AI_NUMERICHOST", value: 4, type: "number", description: "Prevent hostname resolution" }],
  ["AI_NUMERICSERV", { name: "AI_NUMERICSERV", value: 1024, type: "number", description: "Prevent service name resolution" }],
  ["AI_PASSIVE", { name: "AI_PASSIVE", value: 1, type: "number", description: "Use passive socket" }],
  ["AI_V4MAPPED", { name: "AI_V4MAPPED", value: 8, type: "number", description: "Map IPv6 addresses to IPv4-mapped format" }],

  // Name Info Constants
  ["NI_DGRAM", { name: "NI_DGRAM", value: 16, type: "number", description: "Datagram socket type" }],
  ["NI_IDN", { name: "NI_IDN", value: 64, type: "number", description: "Enable IDN encoding" }],
  ["NI_MAXHOST", { name: "NI_MAXHOST", value: 1025, type: "number", description: "Maximum hostname length" }],
  ["NI_MAXSERV", { name: "NI_MAXSERV", value: 32, type: "number", description: "Maximum service name length" }],
  ["NI_NAMEREQD", { name: "NI_NAMEREQD", value: 8, type: "number", description: "Hostname resolution required" }],
  ["NI_NOFQDN", { name: "NI_NOFQDN", value: 4, type: "number", description: "Do not force fully qualified domain name" }],
  ["NI_NUMERICHOST", { name: "NI_NUMERICHOST", value: 1, type: "number", description: "Return numeric form of the hostname" }],
  ["NI_NUMERICSERV", { name: "NI_NUMERICSERV", value: 2, type: "number", description: "Return numeric form of the service name" }],

  // Poll Event Constants
  ["POLLIN", { name: "POLLIN", value: 1, type: "number", description: "Data available to read" }],
  ["POLLPRI", { name: "POLLPRI", value: 2, type: "number", description: "Priority data available to read" }],
  ["POLLOUT", { name: "POLLOUT", value: 4, type: "number", description: "Writable data available" }],
  ["POLLERR", { name: "POLLERR", value: 8, type: "number", description: "Error condition" }],
  ["POLLHUP", { name: "POLLHUP", value: 16, type: "number", description: "Hang up" }],
  ["POLLNVAL", { name: "POLLNVAL", value: 32, type: "number", description: "Invalid request" }],
  ["POLLRDHUP", { name: "POLLRDHUP", value: 8192, type: "number", description: "Peer closed or shutdown writing (Linux only)" }],

  // Socket Credential Messages
  ["SCM_CREDENTIALS", { name: "SCM_CREDENTIALS", value: 2, type: "number", description: "Credentials passing (Linux only)" }],
  ["SCM_RIGHTS", { name: "SCM_RIGHTS", value: 1, type: "number", description: "File descriptor passing (Linux only)" }]
]);

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