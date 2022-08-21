#include "jsapi.h"

static void FinalizePluginInstance(Napi::Env /*env*/, PluginInstance *data)
{
	delete data;
}

Napi::Object Init(Napi::Env env, Napi::Object exports)
{
	auto *inst = new PluginInstance();

	env.SetInstanceData<PluginInstance, FinalizePluginInstance>(inst);

	napi_add_env_cleanup_hook(env, [](void *) { OSShutdownX11(); }, nullptr);

	exports.Set("captureWindowMulti", Napi::Function::New(env, CaptureWindowMulti));
	exports.Set("getRsHandles", Napi::Function::New(env, GetRsHandles));
	exports.Set("getWindowBounds", Napi::Function::New(env, GetWindowBounds));
	exports.Set("getClientBounds", Napi::Function::New(env, GetClientBounds));
	exports.Set("getWindowTitle", Napi::Function::New(env, GetWindowTitle));
	exports.Set("setWindowParent", Napi::Function::New(env, SetWindowParent));
	exports.Set("getActiveWindow", Napi::Function::New(env, JSGetActiveWindow));
	exports.Set("getMouseState", Napi::Function::New(env, GetMouseState));
	exports.Set("setWindowShape", Napi::Function::New(env, SetWindowShape));
	exports.Set("getCursorScreenPoint", Napi::Function::New(env, GetCursorScreenPoint));
	exports.Set("getScale", Napi::Function::New(env, GetScale));

	exports.Set("newWindowListener", Napi::Function::New(env, NewWindowListener));
	exports.Set("removeWindowListener", Napi::Function::New(env, RemoveWindowListener));
	exports.Set("shutdown", Napi::Function::New(env, Shutdown));
	return exports;
}

NODE_API_MODULE(hello, Init)
