// viewer.cpp — reads shared memory and saves frames as PPM files
// compile: g++ viewer.cpp -o viewer -lrt
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

// Must match your shared_capture.h exactly
struct SharedCaptureBuffer {
  uint32_t width;
  uint32_t height;
  uint32_t sequence;
  uint32_t ready;
  uint8_t data[];
};

constexpr const char *SHM_NAME = "/altus_gl_capture";

void savePPM(const char *path, const uint8_t *bgra, int w, int h) {
  FILE *f = fopen(path, "wb");
  fprintf(f, "P6\n%d %d\n255\n", w, h);
  for (int i = 0; i < w * h; i++) {
    // BGRA -> RGB
    fputc(bgra[i * 4 + 2], f);
    fputc(bgra[i * 4 + 1], f);
    fputc(bgra[i * 4 + 0], f);
  }
  fclose(f);
}

int main() {
  int fd = shm_open(SHM_NAME, O_RDONLY, 0);
  if (fd < 0) {
    perror("shm_open — is the target running with LD_PRELOAD?");
    return 1;
  }

  // Map header to get dimensions
  auto *hdr = (SharedCaptureBuffer *)mmap(nullptr, sizeof(SharedCaptureBuffer),
                                          PROT_READ, MAP_SHARED, fd, 0);

  size_t fullSize = sizeof(SharedCaptureBuffer) + hdr->width * hdr->height * 4;
  munmap(hdr, sizeof(SharedCaptureBuffer));

  auto *shm = (SharedCaptureBuffer *)mmap(nullptr, fullSize, PROT_READ,
                                          MAP_SHARED, fd, 0);

  printf("Connected: %dx%d\n", shm->width, shm->height);

  uint32_t lastSeq = 0;
  int frameCount = 0;
  while (frameCount < 10) {
    uint32_t seq = __atomic_load_n(&shm->sequence, __ATOMIC_ACQUIRE);
    if (seq == lastSeq) {
      usleep(1000);
      continue;
    }
    lastSeq = seq;

    char path[64];
    snprintf(path, sizeof(path), "frame_%04d.ppm", frameCount++);
    savePPM(path, shm->data, shm->width, shm->height);
    printf("Saved %s (seq=%u)\n", path, seq);
  }

  munmap(shm, fullSize);
  close(fd);
  return 0;
}
