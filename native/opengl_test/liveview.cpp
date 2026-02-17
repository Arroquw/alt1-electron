// liveview.cpp
// compile: g++ liveview.cpp -o liveview -lrt -lSDL2
#include "shared_capture.h"
#include <SDL2/SDL.h>
#include <fcntl.h>
#include <sys/mman.h>

#define SHM_NAME "/altus_gl_capture"

int main() {
  SDL_Init(SDL_INIT_VIDEO);

  // Open shared memory (same as viewer.cpp above)
  int fd = shm_open(SHM_NAME, O_RDONLY, 0);
  if (fd < 0) {
    perror("shm_open");
    return 1;
  }

  auto *hdr = (SharedCaptureBuffer *)mmap(nullptr, sizeof(SharedCaptureBuffer),
                                          PROT_READ, MAP_SHARED, fd, 0);
  int w = hdr->width, h = hdr->height;
  size_t fullSize = sizeof(SharedCaptureBuffer) + w * h * 4;
  munmap(hdr, sizeof(SharedCaptureBuffer));

  auto *shm = (SharedCaptureBuffer *)mmap(nullptr, fullSize, PROT_READ,
                                          MAP_SHARED, fd, 0);

  SDL_Window *win =
      SDL_CreateWindow("GL Capture Preview", SDL_WINDOWPOS_CENTERED,
                       SDL_WINDOWPOS_CENTERED, w, h, 0);
  SDL_Renderer *ren = SDL_CreateRenderer(win, -1, 0);
  SDL_Texture *tex = SDL_CreateTexture(ren, SDL_PIXELFORMAT_BGRA32,
                                       SDL_TEXTUREACCESS_STREAMING, w, h);

  uint32_t lastSeq = 0;
  bool running = true;
  while (running) {
    SDL_Event e;
    while (SDL_PollEvent(&e))
      if (e.type == SDL_QUIT)
        running = false;

    uint32_t seq = __atomic_load_n(&shm->sequence, __ATOMIC_ACQUIRE);
    if (seq != lastSeq) {
      lastSeq = seq;
      void *pixels;
      int pitch;
      SDL_LockTexture(tex, nullptr, &pixels, &pitch);
      memcpy(pixels, shm->data, w * h * 4);
      SDL_UnlockTexture(tex);
      SDL_RenderCopy(ren, tex, nullptr, nullptr);
      SDL_RenderPresent(ren);
    }
    SDL_Delay(1);
  }
  return 0;
}
