// Named import style
import { statvfs, ST_RDONLY, ST_NOSUID } from 'fs';

let stats = statvfs("/tmp");

if (stats) {
	printf("Block size: %d\n", stats.bsize);
	printf("Total size: %d bytes\n", stats.totalsize);
	printf("Free space: %d bytes\n", stats.freesize);
	printf("Total inodes: %d\n", stats.files);
	printf("Free inodes: %d\n", stats.ffree);

	// Check mount flags
	if (stats.flag & ST_RDONLY)
		printf("Filesystem is read-only\n");

	if (!(stats.flag & ST_NOSUID))
		printf("Filesystem allows setuid\n");
}

// Namespace import style
import * as fs from 'fs';

let stats2 = fs.statvfs('/');

if (stats2) {
	printf("Free: %d bytes\n", stats2.bavail);
	printf("Total: %d bytes\n", stats2.totalsize);
}
