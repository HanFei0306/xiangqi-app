LOCAL_PATH := $(call my-dir)
PIKAFISH_SRC := $(LOCAL_PATH)/pikafish

# --- Safe skeleton (always built, never used for real moves) -----------------
include $(CLEAR_VARS)
LOCAL_MODULE := pikafish_skeleton
LOCAL_SRC_FILES := pikafish_skeleton.cpp
LOCAL_LDLIBS := -llog
include $(BUILD_SHARED_LIBRARY)

# --- Real Pikafish native engine (pikafish-nc build only) --------------------
include $(CLEAR_VARS)
LOCAL_MODULE := pikafish_nc
LOCAL_SRC_FILES := pikafish_jni.cpp
LOCAL_SRC_FILES += $(patsubst $(PIKAFISH_SRC)/%,pikafish/%,$(wildcard $(PIKAFISH_SRC)/*.cpp))
LOCAL_SRC_FILES += $(patsubst $(PIKAFISH_SRC)/%,pikafish/%,$(wildcard $(PIKAFISH_SRC)/nnue/*.cpp))
LOCAL_SRC_FILES += $(patsubst $(PIKAFISH_SRC)/%,pikafish/%,$(wildcard $(PIKAFISH_SRC)/nnue/features/*.cpp))
LOCAL_SRC_FILES += $(patsubst $(PIKAFISH_SRC)/%,pikafish/%,$(wildcard $(PIKAFISH_SRC)/external/common/*.cpp))
LOCAL_SRC_FILES += $(patsubst $(PIKAFISH_SRC)/%,pikafish/%,$(wildcard $(PIKAFISH_SRC)/external/decompress/*.cpp))
LOCAL_SRC_FILES := $(filter-out pikafish/main.cpp,$(LOCAL_SRC_FILES))
LOCAL_C_INCLUDES := $(PIKAFISH_SRC) $(PIKAFISH_SRC)/nnue $(PIKAFISH_SRC)/external/common $(PIKAFISH_SRC)/external/decompress
LOCAL_CPPFLAGS := -std=c++17 -fno-exceptions -O3 -DNDEBUG -DTARGET_ARM
ifeq ($(TARGET_ARCH_ABI),arm64-v8a)
  LOCAL_CPPFLAGS += -DIS_64BIT -DARCH_ARM64
endif
ifeq ($(TARGET_ARCH_ABI),armeabi-v7a)
  LOCAL_CPPFLAGS += -mfpu=neon -mfloat-abi=softfp
endif
LOCAL_LDLIBS := -llog
include $(BUILD_SHARED_LIBRARY)
