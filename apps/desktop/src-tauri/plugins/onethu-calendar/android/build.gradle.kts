plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

// exFAT 兼容：源码在 exFAT 上没问题，但 macOS 会给产物挂 ._ 资源叉文件
// （._EventArg.class 等），库模块打包拷贝时被当成重复类文件而报错。
// 把本模块的全部构建产物挪到 APFS 盘（/tmp），彻底避开。
layout.buildDirectory.set(file("/tmp/onethu-android-plugin-build/onethu-calendar"))

android {
    namespace = "app.onethu.calendar"
    compileSdk = 36

    defaultConfig {
        minSdk = 24
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        consumerProguardFiles("consumer-rules.pro")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.9.0")
    implementation(project(":tauri-android"))
}
